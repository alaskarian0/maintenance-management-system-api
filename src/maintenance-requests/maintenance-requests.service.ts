import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MaintenancePriority,
  MaintenanceRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { WorkshopsService } from '../workshops/workshops.service';
import { Prisma } from '@prisma/client';
import { CreateMaintenanceRequestDto } from './dto/create-maintenance-request.dto';
import { AssignMaintenanceRequestDto } from './dto/assign-maintenance-request.dto';
import { ApproveMaintenanceRequestDto } from './dto/approve-maintenance-request.dto';
import { RejectMaintenanceRequestDto } from './dto/reject-maintenance-request.dto';
import { ResolveMaintenanceRequestDto } from './dto/resolve-maintenance-request.dto';

const INCLUDE = {
  deviceItem: {
    include: {
      device: { include: { category: { include: { deviceType: true } } } },
      assignment: {
        include: {
          unit: {
            include: { division: { include: { department: true } } },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class MaintenanceRequestsService {
  constructor(
    private prisma: PrismaService,
    private maintenanceService: MaintenanceService,
    private workshopsService: WorkshopsService,
  ) {}

  create(dto: CreateMaintenanceRequestDto) {
    return this.prisma.maintenanceRequest.create({
      data: {
        deviceItemId: dto.deviceItemId,
        description: dto.description,
        priority: dto.priority ?? MaintenancePriority.MEDIUM,
        requestedBy: dto.requestedBy,
        assignedTo: dto.assignedTo,
        notes: dto.notes,
        workshopId: dto.workshopId,
      },
      include: INCLUDE,
    });
  }
  async findAll(query: {
    status?: MaintenanceRequestStatus;
    requestedBy?: string;
    assignedTo?: string;
    deviceItemId?: string;
    userWorkshopId?: string;
    userRole?: string;
  }) {
    const where: Prisma.MaintenanceRequestWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.requestedBy) where.requestedBy = query.requestedBy;
    if (query.assignedTo) where.assignedTo = query.assignedTo;
    if (query.deviceItemId) where.deviceItemId = query.deviceItemId;

    // Workshop Visibility Filtering
    if (query.userRole !== 'ADMIN') {
      const accessibleIds = await this.workshopsService.getAccessibleWorkshopIds(query.userWorkshopId || null);
      where.OR = [
        { workshopId: { in: accessibleIds } },
        { workshopId: null },
        { deviceItem: { device: { category: { isGlobal: true } } } },
      ];
    }

    const priorityOrder: MaintenancePriority[] = [
      MaintenancePriority.CRITICAL,
      MaintenancePriority.HIGH,
      MaintenancePriority.MEDIUM,
      MaintenancePriority.LOW,
    ];
    const rows = await this.prisma.maintenanceRequest.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    rows.sort(
      (a, b) =>
        priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority),
    );
    return rows;
  }

  async approve(id: string, dto: ApproveMaintenanceRequestDto) {
    const row = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('الطلب غير موجود');
    if (row.status !== MaintenanceRequestStatus.PENDING) {
      throw new BadRequestException('لا يمكن اعتماد هذا الطلب في حالته الحالية');
    }
    return this.prisma.maintenanceRequest.update({
      where: { id },
      data: {
        status: MaintenanceRequestStatus.APPROVED,
        approvedBy: dto.approvedBy,
      },
      include: INCLUDE,
    });
  }

  async reject(id: string, dto: RejectMaintenanceRequestDto) {
    const row = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('الطلب غير موجود');
    if (row.status !== MaintenanceRequestStatus.PENDING) {
      throw new BadRequestException('لا يمكن رفض هذا الطلب في حالته الحالية');
    }
    return this.prisma.maintenanceRequest.update({
      where: { id },
      data: {
        status: MaintenanceRequestStatus.REJECTED,
        approvedBy: dto.approvedBy,
        notes: dto.notes ?? row.notes,
      },
      include: INCLUDE,
    });
  }

  async assign(id: string, dto: AssignMaintenanceRequestDto) {
    const row = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('الطلب غير موجود');
    if (row.status !== MaintenanceRequestStatus.APPROVED) {
      throw new BadRequestException('يجب اعتماد الطلب قبل التعيين');
    }
    return this.prisma.maintenanceRequest.update({
      where: { id },
      data: {
        status: MaintenanceRequestStatus.ASSIGNED,
        assignedTo: dto.assignedTo,
        approvedBy: row.approvedBy ?? dto.assignedTo,
      },
      include: INCLUDE,
    });
  }

  async resolve(id: string, dto: ResolveMaintenanceRequestDto) {
    const row = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('الطلب غير موجود');
    if (row.status !== MaintenanceRequestStatus.ASSIGNED) {
      throw new BadRequestException('يجب أن يكون الطلب معيناً للفني قبل الإغلاق');
    }

    await this.maintenanceService.create(row.deviceItemId, {
      description: dto.description ?? row.description,
      technicianName: dto.technicianName,
      status: dto.status ?? 'RESOLVED',
      date: dto.date ?? new Date().toISOString(),
      partsUsed: dto.partsUsed,
    });

    return this.prisma.maintenanceRequest.update({
      where: { id },
      data: { status: MaintenanceRequestStatus.RESOLVED },
      include: INCLUDE,
    });
  }
}
