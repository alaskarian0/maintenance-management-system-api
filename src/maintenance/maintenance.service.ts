import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateMaintenanceRecordDto } from './dto/create-maintenance-record.dto';
import { UpdateMaintenanceRecordDto } from './dto/update-maintenance-record.dto';
import { normalizePartsUsed } from './parts-used.util';

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
        ...(dto.partsUsed !== undefined
          ? { partsUsed: normalizePartsUsed(dto.partsUsed) }
          : {}),
      },
    });
  }

  update(deviceId: string, recordId: string, dto: UpdateMaintenanceRecordDto) {
    const { date: dateStr, partsUsed, ...rest } = dto;
    return this.prisma.maintenanceRecord.update({
      where: { id: recordId, deviceId },
      data: {
        ...rest,
        ...(dateStr !== undefined ? { date: new Date(dateStr) } : {}),
        ...(partsUsed !== undefined
          ? { partsUsed: normalizePartsUsed(partsUsed) }
          : {}),
      },
    });
  }

  remove(deviceId: string, recordId: string) {
    return this.prisma.maintenanceRecord.delete({
      where: { id: recordId, deviceId },
    });
  }

  findRecent(limit: number) {
    return this.prisma.maintenanceRecord.findMany({
      take: limit,
      orderBy: { date: 'desc' },
      include: {
        device: {
          select: {
            serialNumber: true,
            category: { select: { name: true } },
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
    });
  }
}
