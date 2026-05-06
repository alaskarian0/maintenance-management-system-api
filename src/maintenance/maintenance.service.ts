import { Injectable } from '@nestjs/common';
import { MaintenanceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SparePartsService } from '../spare-parts/spare-parts.service';
import { CreateMaintenanceRecordDto } from './dto/create-maintenance-record.dto';
import { UpdateMaintenanceRecordDto } from './dto/update-maintenance-record.dto';
import { normalizePartsUsed } from './parts-used.util';

@Injectable()
export class MaintenanceService {
  constructor(
    private prisma: PrismaService,
    private sparePartsService: SparePartsService,
    private activityLog: ActivityLogService,
  ) {}

  findAll(itemId: string) {
    return this.prisma.maintenanceRecord.findMany({
      where: { itemId },
      orderBy: { date: 'desc' },
    });
  }

  async create(
    itemId: string,
    dto: CreateMaintenanceRecordDto,
    actorName = 'غير معروف',
  ) {
    const partsUsed =
      dto.partsUsed !== undefined ? normalizePartsUsed(dto.partsUsed) : undefined;
    const record = await this.prisma.maintenanceRecord.create({
      data: {
        itemId,
        description: dto.description,
        technicianName: dto.technicianName,
        status: dto.status ?? 'OPEN',
        date: new Date(dto.date),
        ...(partsUsed !== undefined ? { partsUsed } : {}),
      },
    });
    if (partsUsed !== undefined) {
      await this.sparePartsService.applyPartsFromMaintenanceRecord(
        record.id,
        partsUsed,
      );
    }
    void this.activityLog.log({
      userName: actorName,
      action: 'MAINTENANCE_CREATED',
      entity: 'MaintenanceRecord',
      entityId: record.id,
      details: { itemId, status: record.status },
    });
    return record;
  }

  async update(
    itemId: string,
    recordId: string,
    dto: UpdateMaintenanceRecordDto,
    actorName = 'غير معروف',
  ) {
    const { date: dateStr, partsUsed, ...rest } = dto;
    const updated = await this.prisma.maintenanceRecord.update({
      where: { id: recordId, itemId },
      data: {
        ...rest,
        ...(dateStr !== undefined ? { date: new Date(dateStr) } : {}),
        ...(partsUsed !== undefined
          ? { partsUsed: normalizePartsUsed(partsUsed) }
          : {}),
      },
    });
    void this.activityLog.log({
      userName: actorName,
      action: 'MAINTENANCE_UPDATED',
      entity: 'MaintenanceRecord',
      entityId: recordId,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  remove(
    itemId: string,
    recordId: string,
    actorName = 'غير معروف',
  ) {
    void this.activityLog.log({
      userName: actorName,
      action: 'MAINTENANCE_DELETED',
      entity: 'MaintenanceRecord',
      entityId: recordId,
    });
    return this.prisma.maintenanceRecord.delete({
      where: { id: recordId, itemId },
    });
  }

  bulkUpdateStatus(ids: string[], status: MaintenanceStatus) {
    return this.prisma.maintenanceRecord.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });
  }

  findRecent(
    limit: number,
    filters?: {
      status?: MaintenanceStatus;
      technicianName?: string;
      departmentId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const where: Prisma.MaintenanceRecordWhereInput = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.technicianName) {
      where.technicianName = {
        contains: filters.technicianName,
        mode: 'insensitive',
      };
    }
    if (filters?.dateFrom || filters?.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.date.lte = new Date(filters.dateTo);
    }
    if (filters?.departmentId) {
      where.item = {
        assignment: {
          unit: { division: { departmentId: filters.departmentId } },
        },
      };
    }

    return this.prisma.maintenanceRecord.findMany({
      where,
      take: limit,
      orderBy: { date: 'desc' },
      include: {
        item: {
          select: {
            serialNumber: true,
            device: {
              select: {
                id: true,
                category: { select: { name: true } },
              },
            },
            assignment: {
              select: {
                unit: {
                  select: {
                    name: true,
                    division: {
                      select: {
                        name: true,
                        department: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }
}
