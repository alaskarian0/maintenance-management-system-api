import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateUserTempScheduleDto, CreateBatchUserTempScheduleDto } from './dto/create-user-temp-schedule.dto';

@Injectable()
export class UserTempScheduleService {
  private readonly logger = new Logger(UserTempScheduleService.name);

  constructor(private prisma: PrismaService) {}

  async findByPerson(personId: string, startDate?: string, endDate?: string) {
    const where: any = { personId };
    if (startDate || endDate) {
      where.comeTime = {};
      if (startDate) where.comeTime.gte = new Date(startDate);
      if (endDate) where.comeTime.lte = new Date(endDate);
    }

    return this.prisma.userTempSchedule.findMany({
      where,
      orderBy: { comeTime: 'asc' },
      include: { shiftClass: true },
    });
  }

  async findByDateRange(startDate: string, endDate: string) {
    return this.prisma.userTempSchedule.findMany({
      where: {
        comeTime: { gte: new Date(startDate) },
        leaveTime: { lte: new Date(endDate) },
      },
      orderBy: { comeTime: 'asc' },
      include: { person: { select: { id: true, name: true, empCode: true } }, shiftClass: true },
    });
  }

  async create(dto: CreateUserTempScheduleDto) {
    return this.prisma.userTempSchedule.create({
      data: {
        personId: dto.personId,
        shiftClassId: dto.shiftClassId,
        comeTime: new Date(dto.comeTime),
        leaveTime: new Date(dto.leaveTime),
        scheduleType: dto.scheduleType ?? 0,
        flag: dto.flag ?? 1,
        overtime: dto.overtime ?? false,
        zktecoSchClassId: dto.zktecoSchClassId,
      },
    });
  }

  async createBatch(dto: CreateBatchUserTempScheduleDto) {
    let created = 0;
    let errors = 0;

    const BATCH_SIZE = 500;
    const batches: CreateUserTempScheduleDto[][] = [];
    for (let i = 0; i < dto.schedules.length; i += BATCH_SIZE) {
      batches.push(dto.schedules.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      const data = batch.map(s => ({
        personId: s.personId,
        shiftClassId: s.shiftClassId,
        comeTime: new Date(s.comeTime),
        leaveTime: new Date(s.leaveTime),
        scheduleType: s.scheduleType ?? 0,
        flag: s.flag ?? 1,
        overtime: s.overtime ?? false,
        zktecoSchClassId: s.zktecoSchClassId,
      }));

      try {
        const result = await this.prisma.userTempSchedule.createMany({ data });
        created += result.count;
      } catch (err) {
        errors += batch.length;
        this.logger.warn(`Batch insert failed: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      }
    }

    this.logger.log(`Batch create: ${created} created, ${errors} errors out of ${dto.schedules.length}`);
    return { created, errors, total: dto.schedules.length };
  }

  async remove(id: string) {
    const schedule = await this.prisma.userTempSchedule.findUnique({ where: { id } });
    if (!schedule) throw new NotFoundException(`Schedule with id "${id}" not found`);
    return this.prisma.userTempSchedule.delete({ where: { id } });
  }

  async removeByPerson(personId: string) {
    const result = await this.prisma.userTempSchedule.deleteMany({ where: { personId } });
    return { deleted: result.count };
  }

  async getScheduleStats() {
    const total = await this.prisma.userTempSchedule.count();
    const byShiftClass = await this.prisma.userTempSchedule.groupBy({
      by: ['zktecoSchClassId'],
      _count: true,
    });

    const persons = await this.prisma.userTempSchedule.groupBy({
      by: ['personId'],
      _count: true,
    });

    return {
      total,
      uniquePersons: persons.length,
      byShiftClass: byShiftClass.map(g => ({
        zktecoSchClassId: g.zktecoSchClassId,
        count: g._count,
      })),
    };
  }
}
