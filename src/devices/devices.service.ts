import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { QueryDeviceDto } from './dto/query-device.dto';

const DEVICE_INCLUDE = {
  category: true,
  unit: {
    include: {
      division: {
        include: { department: true },
      },
    },
  },
};

@Injectable()
export class DevicesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryDeviceDto) {
    const { search, categoryId, unitId, page = '1', limit = '20' } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (search) where.serialNumber = { contains: search, mode: 'insensitive' };
    if (categoryId) where.categoryId = categoryId;
    if (unitId) where.unitId = unitId;

    const [data, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        include: DEVICE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      this.prisma.device.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
  }

  findOne(id: string) {
    return this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: DEVICE_INCLUDE,
    });
  }

  create(dto: CreateDeviceDto) {
    return this.prisma.device.create({
      data: {
        serialNumber: dto.serialNumber,
        categoryId: dto.categoryId,
        unitId: dto.unitId,
        notes: dto.notes,
      },
      include: DEVICE_INCLUDE,
    });
  }

  update(id: string, dto: UpdateDeviceDto) {
    return this.prisma.device.update({
      where: { id },
      data: dto,
      include: DEVICE_INCLUDE,
    });
  }

  remove(id: string) {
    return this.prisma.device.delete({ where: { id } });
  }
}
