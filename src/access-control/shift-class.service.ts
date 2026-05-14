import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateShiftClassDto } from './dto/create-shift-class.dto';
import { UpdateShiftClassDto } from './dto/update-shift-class.dto';

@Injectable()
export class ShiftClassService {
  private readonly logger = new Logger(ShiftClassService.name);

  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.shiftClass.findMany({
      orderBy: { zktecoSchClassId: 'asc' },
      include: { _count: { select: { schedules: true } } },
    });
  }

  async findOne(id: string) {
    const shift = await this.prisma.shiftClass.findUnique({ where: { id } });
    if (!shift) throw new NotFoundException(`ShiftClass with id "${id}" not found`);
    return shift;
  }

  async create(dto: CreateShiftClassDto) {
    return this.prisma.shiftClass.create({
      data: {
        zktecoSchClassId: dto.zktecoSchClassId,
        name: dto.name,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        lateMinutes: dto.lateMinutes ?? 0,
        earlyMinutes: dto.earlyMinutes ?? 0,
        checkIn: dto.checkIn ?? true,
        checkOut: dto.checkOut ?? true,
        workDay: dto.workDay ?? 1.0,
        color: dto.color ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateShiftClassDto) {
    await this.findOne(id);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.startTime !== undefined) data.startTime = new Date(dto.startTime);
    if (dto.endTime !== undefined) data.endTime = new Date(dto.endTime);
    if (dto.lateMinutes !== undefined) data.lateMinutes = dto.lateMinutes;
    if (dto.earlyMinutes !== undefined) data.earlyMinutes = dto.earlyMinutes;
    if (dto.checkIn !== undefined) data.checkIn = dto.checkIn;
    if (dto.checkOut !== undefined) data.checkOut = dto.checkOut;
    if (dto.workDay !== undefined) data.workDay = dto.workDay;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.zktecoSchClassId !== undefined) data.zktecoSchClassId = dto.zktecoSchClassId;

    return this.prisma.shiftClass.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.shiftClass.delete({ where: { id } });
  }

  async findByZktecoId(zktecoSchClassId: number) {
    return this.prisma.shiftClass.findUnique({ where: { zktecoSchClassId } });
  }

  async upsertFromMigration(dto: CreateShiftClassDto) {
    return this.prisma.shiftClass.upsert({
      where: { zktecoSchClassId: dto.zktecoSchClassId },
      create: {
        zktecoSchClassId: dto.zktecoSchClassId,
        name: dto.name,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        lateMinutes: dto.lateMinutes ?? 0,
        earlyMinutes: dto.earlyMinutes ?? 0,
        checkIn: dto.checkIn ?? true,
        checkOut: dto.checkOut ?? true,
        workDay: dto.workDay ?? 1.0,
        color: dto.color ?? 0,
      },
      update: {
        name: dto.name,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        lateMinutes: dto.lateMinutes ?? 0,
        earlyMinutes: dto.earlyMinutes ?? 0,
        checkIn: dto.checkIn ?? true,
        checkOut: dto.checkOut ?? true,
        workDay: dto.workDay ?? 1.0,
        color: dto.color ?? 0,
      },
    });
  }
}
