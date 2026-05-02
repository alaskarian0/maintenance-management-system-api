import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateMaintenanceRecordDto } from './dto/create-maintenance-record.dto';
import { UpdateMaintenanceRecordDto } from './dto/update-maintenance-record.dto';

@Injectable()
export class MaintenanceService {
  constructor(private prisma: PrismaService) {}

  findAll(deviceId: string) {
    return this.prisma.maintenanceRecord.findMany({
      where: { deviceId },
      orderBy: { date: 'desc' },
    });
  }

  create(deviceId: string, dto: CreateMaintenanceRecordDto) {
    return this.prisma.maintenanceRecord.create({
      data: {
        deviceId,
        description: dto.description,
        technicianName: dto.technicianName,
        status: dto.status ?? 'OPEN',
        date: new Date(dto.date),
      },
    });
  }

  update(deviceId: string, recordId: string, dto: UpdateMaintenanceRecordDto) {
    return this.prisma.maintenanceRecord.update({
      where: { id: recordId, deviceId },
      data: {
        ...dto,
        date: dto.date ? new Date(dto.date) : undefined,
      },
    });
  }

  remove(deviceId: string, recordId: string) {
    return this.prisma.maintenanceRecord.delete({
      where: { id: recordId, deviceId },
    });
  }
}
