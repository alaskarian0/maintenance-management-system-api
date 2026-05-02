import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MaintenanceStatus } from '@prisma/client';

function aggregatePartsFromJson(
  partsUsed: unknown,
  map: Map<string, number>,
): void {
  if (!Array.isArray(partsUsed)) return;
  for (const item of partsUsed) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as { name?: string }).name ?? '').trim();
    const q = Number((item as { quantity?: number }).quantity);
    if (!name || !Number.isFinite(q) || q <= 0) continue;
    map.set(name, (map.get(name) ?? 0) + q);
  }
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const [
      deviceCount,
      totalRecords,
      openCount,
      inProgressCount,
      resolvedCount,
      monthlyRows,
      recentRecords,
      partsRows,
      statusGroups,
    ] = await Promise.all([
      this.prisma.device.count(),
      this.prisma.maintenanceRecord.count(),
      this.prisma.maintenanceRecord.count({ where: { status: 'OPEN' } }),
      this.prisma.maintenanceRecord.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.maintenanceRecord.count({ where: { status: 'RESOLVED' } }),
      this.prisma.maintenanceRecord.findMany({
        where: { date: { gte: sixMonthsAgo } },
        select: { date: true },
      }),
      this.prisma.maintenanceRecord.findMany({
        take: 6,
        orderBy: { date: 'desc' },
        select: {
          id: true,
          description: true,
          date: true,
          status: true,
          technicianName: true,
          device: { select: { serialNumber: true } },
        },
      }),
      this.prisma.maintenanceRecord.findMany({
        take: 2000,
        orderBy: { date: 'desc' },
        select: { partsUsed: true },
      }),
      this.prisma.maintenanceRecord.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const monthBuckets = new Map<string, number>();
    for (const r of monthlyRows) {
      const d = r.date;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + 1);
    }
    const monthlyMaintenance = Array.from(monthBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count }));

    const partTotals = new Map<string, number>();
    for (const r of partsRows) {
      aggregatePartsFromJson(r.partsUsed, partTotals);
    }
    const topSpareParts = Array.from(partTotals.entries())
      .map(([name, totalQuantity]) => ({ name, totalQuantity }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 8);

    const statusBreakdown = statusGroups.map((g) => ({
      status: g.status as MaintenanceStatus,
      count: g._count._all,
    }));

    return {
      counts: {
        devices: deviceCount,
        maintenanceRecords: totalRecords,
        open: openCount,
        inProgress: inProgressCount,
        resolved: resolvedCount,
        activeWork: openCount + inProgressCount,
      },
      monthlyMaintenance,
      statusBreakdown,
      recentMaintenance: recentRecords.map((r) => ({
        id: r.id,
        description: r.description,
        date: r.date.toISOString(),
        status: r.status,
        technicianName: r.technicianName,
        deviceSerial: r.device.serialNumber,
      })),
      topSpareParts,
    };
  }
}
