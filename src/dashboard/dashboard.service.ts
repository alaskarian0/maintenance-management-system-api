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

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const now = new Date();

    const warrantyHorizon = new Date(now);
    warrantyHorizon.setDate(warrantyHorizon.getDate() + 60);

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
      stockGroups,
      assignedForDept,
      recentAssignments,
      openTicketsForAging,
      resolvedSamples,
      techResolved,
      warrantySoon,
    ] = await Promise.all([
      this.prisma.device.count(),
      this.prisma.maintenanceRecord.count(),
      this.prisma.maintenanceRecord.count({ where: { status: 'OPEN' } }),
      this.prisma.maintenanceRecord.count({
        where: { status: 'IN_PROGRESS' },
      }),
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
          item: { select: { serialNumber: true } },
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
      this.prisma.deviceItem.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.deviceItem.findMany({
        where: { status: 'ASSIGNED' },
        select: {
          assignment: {
            select: {
              unit: {
                select: {
                  division: {
                    select: {
                      department: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.deviceAssignment.findMany({
        orderBy: { assignedAt: 'desc' },
        take: 8,
        include: {
          item: {
            select: {
              serialNumber: true,
              device: { select: { name: true } },
            },
          },
          unit: {
            include: { division: { include: { department: true } } },
          },
        },
      }),
      this.prisma.maintenanceRecord.findMany({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
        select: {
          id: true,
          description: true,
          createdAt: true,
          status: true,
          item: { select: { serialNumber: true } },
        },
        take: 200,
      }),
      this.prisma.maintenanceRecord.findMany({
        where: {
          status: 'RESOLVED',
          updatedAt: { gte: sixMonthsAgo },
        },
        select: {
          createdAt: true,
          updatedAt: true,
          technicianName: true,
        },
        take: 3000,
      }),
      this.prisma.maintenanceRecord.groupBy({
        by: ['technicianName'],
        where: {
          status: 'RESOLVED',
          updatedAt: { gte: sixMonthsAgo },
        },
        _count: { _all: true },
      }),
      this.prisma.deviceItem.findMany({
        where: {
          warrantyExpiry: {
            not: null,
            gte: now,
            lte: warrantyHorizon,
          },
        },
        take: 12,
        orderBy: { warrantyExpiry: 'asc' },
        select: {
          id: true,
          serialNumber: true,
          warrantyExpiry: true,
          device: { select: { id: true, name: true } },
        },
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

    const stockSummary = stockGroups.map((g) => ({
      status: g.status,
      count: g._count._all,
    }));

    const deptMap = new Map<string, number>();
    for (const row of assignedForDept) {
      const name =
        row.assignment?.unit?.division?.department?.name ?? 'غير معيّن';
      deptMap.set(name, (deptMap.get(name) ?? 0) + 1);
    }
    const departmentBreakdown = Array.from(deptMap.entries())
      .map(([departmentName, count]) => ({ departmentName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const treemapDepartments = departmentBreakdown.map((d) => ({
      name: d.departmentName,
      size: d.count,
    }));

    const recentTransfers = recentAssignments.map((a) => ({
      id: a.id,
      serialNumber: a.item.serialNumber,
      deviceName: a.item.device?.name,
      recipientName: a.recipientName,
      assignedAt: a.assignedAt.toISOString(),
      unitPath: `${a.unit.division.department.name} / ${a.unit.division.name} / ${a.unit.name}`,
    }));

    const agingAlerts = openTicketsForAging
      .map((t) => ({
        id: t.id,
        description: t.description,
        status: t.status,
        serialNumber: t.item.serialNumber,
        createdAt: t.createdAt.toISOString(),
        daysOpen: Math.floor(daysBetween(t.createdAt, now)),
      }))
      .filter((t) => t.daysOpen >= 7)
      .sort((a, b) => b.daysOpen - a.daysOpen)
      .slice(0, 15);

    let avgResolutionDays = 0;
    const resolutionBuckets = new Map<string, { totalDays: number; n: number }>();
    for (const r of resolvedSamples) {
      const days = daysBetween(r.createdAt, r.updatedAt);
      if (!Number.isFinite(days) || days < 0) continue;
      avgResolutionDays += days;
      const key = `${r.updatedAt.getFullYear()}-${String(r.updatedAt.getMonth() + 1).padStart(2, '0')}`;
      const b = resolutionBuckets.get(key) ?? { totalDays: 0, n: 0 };
      b.totalDays += days;
      b.n += 1;
      resolutionBuckets.set(key, b);
    }
    if (resolvedSamples.length > 0) {
      avgResolutionDays /= resolvedSamples.length;
    }

    const monthlyResolutionAvg = Array.from(resolutionBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        avgDays: v.n > 0 ? v.totalDays / v.n : 0,
      }))
      .slice(-6);

    const technicianPerformance = techResolved
      .map((t) => ({
        technicianName: t.technicianName,
        resolvedCount: t._count._all,
      }))
      .sort((a, b) => b.resolvedCount - a.resolvedCount)
      .slice(0, 12);

    const totalItems = stockSummary.reduce((s, x) => s + x.count, 0);
    const deviceHealth = stockSummary.map((s) => ({
      status: s.status,
      count: s.count,
      percent: totalItems > 0 ? Math.round((s.count / totalItems) * 1000) / 10 : 0,
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
        deviceSerial: r.item.serialNumber,
      })),
      topSpareParts,
      stockSummary,
      departmentBreakdown,
      treemapDepartments,
      recentTransfers,
      agingAlerts,
      agingBuckets: {
        over7: openTicketsForAging.filter((t) => daysBetween(t.createdAt, now) >= 7).length,
        over14: openTicketsForAging.filter((t) => daysBetween(t.createdAt, now) >= 14).length,
        over30: openTicketsForAging.filter((t) => daysBetween(t.createdAt, now) >= 30).length,
      },
      avgResolutionDays: Math.round(avgResolutionDays * 10) / 10,
      monthlyResolutionAvg,
      technicianPerformance,
      deviceHealth,
      warrantyExpiringSoon: warrantySoon.map((w) => ({
        id: w.id,
        serialNumber: w.serialNumber,
        deviceId: w.device.id,
        deviceName: w.device.name,
        warrantyExpiry: w.warrantyExpiry?.toISOString() ?? null,
      })),
    };
  }
}
