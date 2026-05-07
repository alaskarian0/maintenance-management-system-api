import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AccessFallbackService } from './access-fallback.service';

@Injectable()
export class AccessLogService {
  private readonly logger = new Logger(AccessLogService.name);

  constructor(
    private prisma: PrismaService,
    private fallback: AccessFallbackService,
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

  async syncFromDevice(doorId: string): Promise<{ synced: number; skipped: number; total: number }> {
    const door = await this.prisma.accessDoor.findUnique({ where: { id: doorId } });
    if (!door?.ipAddress) {
      return { synced: 0, skipped: 0, total: 0 };
    }

    const logs = await this.fallback.getDeviceAttendanceLogs(door.ipAddress);
    let synced = 0;
    let skipped = 0;

    for (const log of logs) {
      // Check for duplicate by door + punchTime + deviceUserId
      const existing = await this.prisma.accessLog.findFirst({
        where: {
          doorId: door.id,
          punchTime: log.timestamp,
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Try to find matching person by deviceUserId (personId) or empCode
      const deviceUserIdNum = parseInt(String(log.deviceUserId), 10);
      const person = log.deviceUserId
        ? await this.prisma.accessPerson.findFirst({
            where: {
              OR: [
                ...(isNaN(deviceUserIdNum) ? [] : [{ personId: deviceUserIdNum }]),
                { empCode: String(log.deviceUserId) },
              ],
            },
          })
        : null;

      await this.prisma.accessLog.create({
        data: {
          personId: person?.id || null,
          doorId: door.id,
          punchTime: log.timestamp,
          punchState: log.state,
          verifyType: log.verifyType,
          status: person ? 'authorized' : 'unknown',
          syncedFromZKBio: false, // kept for DB compat
        },
      });
      synced++;
    }

    return { synced, skipped, total: logs.length };
  }

  async syncAllDevices(): Promise<{ doorId: string; doorName: string; synced: number; skipped: number; total: number; error?: string }[]> {
    const doors = await this.prisma.accessDoor.findMany({ where: { state: 1 } });
    const results = [];

    for (const door of doors) {
      if (!door.ipAddress) continue;
      try {
        const sync = await this.syncFromDevice(door.id);
        results.push({
          doorId: door.id,
          doorName: door.name,
          ...sync,
        });
      } catch (err) {
        results.push({
          doorId: door.id,
          doorName: door.name,
          synced: 0,
          skipped: 0,
          total: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
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
