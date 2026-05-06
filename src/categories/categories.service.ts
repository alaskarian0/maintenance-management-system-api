import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateDeviceTypeDto } from './dto/create-device-type.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  findAllTypes() {
    return this.prisma.deviceType.findMany({
      include: { categories: { orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  createType(dto: CreateDeviceTypeDto) {
    return this.prisma.deviceType.create({ data: { name: dto.name } });
  }

  removeType(id: string) {
    return this.prisma.deviceType.delete({ where: { id } });
  }

  findAll() {
    return this.prisma.category.findMany({
      include: { deviceType: true },
      orderBy: { name: 'asc' },
    });
  }

  create(dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: { name: dto.name, deviceTypeId: dto.deviceTypeId },
    });
  }

  remove(id: string) {
    return this.prisma.category.delete({ where: { id } });
  }

  findCategoryByName(name: string) {
    return this.prisma.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
  }

  findDeviceTypeByName(name: string) {
    return this.prisma.deviceType.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
  }

  createCategoryByName(name: string, deviceTypeId: string) {
    return this.prisma.category.create({
      data: { name, deviceTypeId },
    });
  }

  createDeviceTypeByName(name: string) {
    return this.prisma.deviceType.create({ data: { name } });
  }
}
