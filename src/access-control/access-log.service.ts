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
    const door = await this.prisma.accessDoor.findUnique({
      where: { id: doorId },
      include: { devices: true },
    });

    // Find a device with IP address under this door
    const device = door?.devices.find(d => d.ipAddress);
    if (!door || !device?.ipAddress) {
      return { synced: 0, skipped: 0, total: 0 };
    }

    const logs = await this.fallback.getDeviceAttendanceLogs(device.ipAddress);
    if (logs.length === 0) {
      return { synced: 0, skipped: 0, total: 0 };
    }

    const uniqueDeviceUserIds = [...new Set(logs.map(l => String(l.deviceUserId)).filter(Boolean))];
    const persons = uniqueDeviceUserIds.length > 0
      ? await this.prisma.accessPerson.findMany({
          where: {
            OR: uniqueDeviceUserIds.flatMap(id => {
              const num = parseInt(id, 10);
              const conditions: { personId?: number; empCode?: string }[] = [{ empCode: id }];
              if (!isNaN(num)) conditions.push({ personId: num });
              return conditions;
            }),
          },
          select: { id: true, personId: true, empCode: true },
        })
      : [];

    const personLookup = new Map<string, string>();
    for (const p of persons) {
      if (p.empCode) personLookup.set(p.empCode, p.id);
      if (p.personId != null) personLookup.set(String(p.personId), p.id);
    }

    const createData = logs.map(log => {
      const personId = personLookup.get(String(log.deviceUserId)) || null;
      return {
        personId,
        doorId: door.id,
        punchTime: log.timestamp,
        punchState: log.state,
        verifyType: log.verifyType,
        status: personId ? 'authorized' as const : 'unknown' as const,
        syncedFromZKBio: false,
      };
    });

    const result = await this.prisma.accessLog.createMany({
      data: createData,
      skipDuplicates: true,
    });

    const synced = result.count;
    const skipped = logs.length - synced;

    try {
      await this.fallback.clearDeviceAttendanceLogs(device.ipAddress);
      this.logger.log(`Cleared logs on device ${device.ipAddress} after syncing ${synced} records`);
    } catch (err) {
      this.logger.warn(`Failed to clear logs on device ${device.ipAddress}: ${err instanceof Error ? err.message : err}`);
    }

    return { synced, skipped, total: logs.length };
  }

  async syncAllDevices(): Promise<{ doorId: string; doorName: string; synced: number; skipped: number; total: number; error?: string }[]> {
    const doors = await this.prisma.accessDoor.findMany({
      include: { devices: true },
    });

    // Only sync doors that have at least one online device with an IP
    const activeDoors = doors.filter(d =>
      d.devices.some(dev => dev.ipAddress && dev.state === 1)
    );

    const results: { doorId: string; doorName: string; synced: number; skipped: number; total: number; error?: string }[] = [];

    const CONCURRENCY = 10;
    for (let i = 0; i < activeDoors.length; i += CONCURRENCY) {
      const chunk = activeDoors.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (door) => {
          const sync = await this.syncFromDevice(door.id);
          return { doorId: door.id, doorName: door.name, ...sync };
        }),
      );

      for (let j = 0; j < settled.length; j++) {
        const outcome = settled[j];
        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
        } else {
          const door = chunk[j];
          results.push({
            doorId: door.id,
            doorName: door.name,
            synced: 0,
            skipped: 0,
            total: 0,
            error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          });
        }
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
        this.prisma.accessDoor.count({
          where: { devices: { some: { state: 1 } } },
        }),
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
