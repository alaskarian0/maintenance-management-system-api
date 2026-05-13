import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateWorkshopDto, UpdateWorkshopDto } from './dto/workshop.dto';

@Injectable()
export class WorkshopsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateWorkshopDto) {
    return this.prisma.workshop.create({
      data: {
        name: dto.name,
      },
    });
  }

  async findAll() {
    return this.prisma.workshop.findMany({
      include: {
        _count: {
          select: { users: true, deviceItems: true },
        },
        allowedToSee: true,
      },
    });
  }

  async findOne(id: string) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id },
      include: {
        allowedToSee: true,
        seenBy: true,
        _count: {
          select: { users: true, deviceItems: true },
        },
      },
    });
    if (!workshop) throw new NotFoundException('الورشة غير موجودة');
    return workshop;
  }

  async update(id: string, dto: UpdateWorkshopDto) {
    const { allowedToSeeIds, ...data } = dto;
    
    return this.prisma.workshop.update({
      where: { id },
      data: {
        ...data,
        allowedToSee: allowedToSeeIds ? {
          set: allowedToSeeIds.map(id => ({ id })),
        } : undefined,
      },
      include: {
        allowedToSee: true,
      },
    });
  }

  async remove(id: string) {
    return this.prisma.workshop.delete({
      where: { id },
    });
  }

  /**
   * Get all workshop IDs that a specific workshop is allowed to see (including itself)
   */
  async getAccessibleWorkshopIds(workshopId: string | null): Promise<string[]> {
    if (!workshopId) return [];
    
    const workshop = await this.prisma.workshop.findUnique({
      where: { id: workshopId },
      include: { allowedToSee: true },
    });
    
    if (!workshop) return [workshopId];
    
    return [workshopId, ...workshop.allowedToSee.map(w => w.id)];
  }
}
