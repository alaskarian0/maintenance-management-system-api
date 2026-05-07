import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ZKBioClient, ZKBioPaginated, ZKBioTransaction } from './zkbio.client';

@Injectable()
export class AccessLogService {
  constructor(
    private prisma: PrismaService,
    private zkBio: ZKBioClient,
  ) {}

  async findAll(filters: {
    doorId?: string;
    personId?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.doorId) where.doorId = filters.doorId;
    if (filters.personId) where.personId = filters.personId;
    if (filters.status) where.status = filters.status;

    if (filters.dateFrom || filters.dateTo) {
      const punchTime: Record<string, Date> = {};
      if (filters.dateFrom) punchTime.gte = new Date(filters.dateFrom);
      if (filters.dateTo) punchTime.lte = new Date(filters.dateTo);
      where.punchTime = punchTime;
    }

    const page = filters.page || 1;
    const pageSize = filters.pageSize || 50;
    const skip = (page - 1) * pageSize;

    const [data, total] = await Promise.all([
      this.prisma.accessLog.findMany({
        where,
        include: { person: true, door: true },
        orderBy: { punchTime: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.accessLog.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async getToday() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.prisma.accessLog.findMany({
      where: { punchTime: { gte: startOfDay } },
      include: { person: true, door: true },
      orderBy: { punchTime: 'desc' },
    });
  }

  async syncFromZKBio() {
    const response = await this.zkBio.get<ZKBioPaginated<ZKBioTransaction>>(
      '/iclock/api/transactions/',
      { page_size: '200' },
    );

    let synced = 0;
    let skipped = 0;

    for (const txn of response.data) {
      const existing = await this.prisma.accessLog.findFirst({
        where: {
          door: { serialNumber: txn.terminal_sn },
          punchTime: new Date(txn.punch_time),
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      const door = await this.prisma.accessDoor.findFirst({
        where: { serialNumber: txn.terminal_sn },
      });

      if (!door) {
        skipped++;
        continue;
      }

      const person = txn.emp_code
        ? await this.prisma.accessPerson.findFirst({
            where: { empCode: txn.emp_code },
          })
        : null;

      await this.prisma.accessLog.create({
        data: {
          personId: person?.id || null,
          doorId: door.id,
          punchTime: new Date(txn.punch_time),
          punchState: txn.punch_state || 0,
          verifyType: txn.verify_type,
          status: person ? 'authorized' : 'unknown',
          syncedFromZKBio: true,
        },
      });
      synced++;
    }

    return { synced, skipped, total: response.count };
  }

  async getStats() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [totalLogs, todayLogs, weekLogs, onlineDoors, totalDoors, totalPersons] =
      await Promise.all([
        this.prisma.accessLog.count(),
        this.prisma.accessLog.count({
          where: { punchTime: { gte: startOfDay } },
        }),
        this.prisma.accessLog.count({
          where: { punchTime: { gte: startOfWeek } },
        }),
        this.prisma.accessDoor.count({ where: { state: 1 } }),
        this.prisma.accessDoor.count(),
        this.prisma.accessPerson.count({ where: { isActive: true } }),
      ]);

    const recentLogs = await this.prisma.accessLog.findMany({
      take: 10,
      orderBy: { punchTime: 'desc' },
      include: { person: true, door: true },
    });

    return {
      totalLogs,
      todayLogs,
      weekLogs,
      onlineDoors,
      totalDoors,
      totalPersons,
      recentLogs,
    };
  }
}
