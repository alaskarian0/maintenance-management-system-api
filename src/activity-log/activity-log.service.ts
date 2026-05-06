import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export type LogEntry = {
  userId?: string | null;
  userName: string;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Prisma.InputJsonValue;
};

@Injectable()
export class ActivityLogService {
  constructor(private prisma: PrismaService) {}

  async log(entry: LogEntry) {
    return this.prisma.activityLog.create({
      data: {
        userId: entry.userId ?? undefined,
        userName: entry.userName,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? undefined,
        details: entry.details ?? undefined,
      },
    });
  }

  async findAll(query: {
    entity?: string;
    action?: string;
    userName?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: string;
    limit?: string;
  }) {
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? '50')));
    const skip = (page - 1) * limit;

    const where: Prisma.ActivityLogWhereInput = {};
    if (query.entity) where.entity = query.entity;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.userName)
      where.userName = { contains: query.userName, mode: 'insensitive' };
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}
