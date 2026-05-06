import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    userId?: string | null;
    type: string;
    title: string;
    message: string;
    relatedId?: string | null;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: data.userId ?? undefined,
        type: data.type,
        title: data.title,
        message: data.message,
        relatedId: data.relatedId ?? undefined,
      },
    });
  }

  async findForUser(userId: string | undefined, limit = 50) {
    const take = Math.min(100, limit);
    const or = userId
      ? [{ userId }, { userId: null }]
      : [{ userId: null }];
    return this.prisma.notification.findMany({
      where: { OR: or },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async unreadCount(userId: string | undefined) {
    const or = userId
      ? [{ userId, isRead: false }, { userId: null, isRead: false }]
      : [{ userId: null, isRead: false }];
    return this.prisma.notification.count({ where: { OR: or } });
  }

  async markRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string | undefined) {
    const or = userId
      ? [{ userId }, { userId: null }]
      : [{ userId: null }];
    return this.prisma.notification.updateMany({
      where: { OR: or, isRead: false },
      data: { isRead: true },
    });
  }

  /** Create alerts for overdue maintenance, low stock, expiring warranties (idempotent per day per entity). */
  async scan() {
    const dayAgo = new Date();
    dayAgo.setDate(dayAgo.getDate() - 1);

    const created: string[] = [];

    const recentDuplicate = async (
      type: string,
      relatedId: string | null,
    ): Promise<boolean> => {
      const found = await this.prisma.notification.findFirst({
        where: {
          type,
          relatedId: relatedId ?? undefined,
          createdAt: { gte: dayAgo },
        },
      });
      return !!found;
    };

    // Overdue: OPEN or IN_PROGRESS maintenance older than 14 days (by record createdAt)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const stale = await this.prisma.maintenanceRecord.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        createdAt: { lt: cutoff },
      },
      take: 50,
      select: { id: true, description: true, item: { select: { serialNumber: true } } },
    });
    for (const r of stale) {
      if (await recentDuplicate('OVERDUE_MAINTENANCE', r.id)) continue;
      await this.create({
        type: 'OVERDUE_MAINTENANCE',
        title: 'صيانة متأخرة',
        message: `سجل صيانة مفتوح للجهاز ${r.item.serialNumber}: ${r.description.slice(0, 80)}`,
        relatedId: r.id,
      });
      created.push(`OVERDUE_MAINTENANCE:${r.id}`);
    }

    // Low stock (quantity below minQuantity per row)
    const allParts = await this.prisma.sparePart.findMany();
    for (const p of allParts) {
      if (p.quantity >= p.minQuantity) continue;
      if (await recentDuplicate('LOW_STOCK', p.id)) continue;
      await this.create({
        type: 'LOW_STOCK',
        title: 'مخزون قطعة منخفض',
        message: `${p.name}: المتبقي ${p.quantity} (الحد الأدنى ${p.minQuantity})`,
        relatedId: p.id,
      });
      created.push(`LOW_STOCK:${p.id}`);
    }

    // Warranty expiring within 30 days
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const items = await this.prisma.deviceItem.findMany({
      where: {
        warrantyExpiry: { lte: soon, gte: new Date() },
      },
      take: 50,
      select: { id: true, serialNumber: true, warrantyExpiry: true },
    });
    for (const it of items) {
      if (await recentDuplicate('WARRANTY_EXPIRING', it.id)) continue;
      await this.create({
        type: 'WARRANTY_EXPIRING',
        title: 'ضمان يوشك على الانتهاء',
        message: `الجهاز ${it.serialNumber} — تاريخ انتهاء الضمان: ${it.warrantyExpiry?.toISOString().slice(0, 10)}`,
        relatedId: it.id,
      });
      created.push(`WARRANTY_EXPIRING:${it.id}`);
    }

    return { createdCount: created.length, keys: created };
  }
}
