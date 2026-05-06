import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /** Full device inventory with status, department, serial numbers */
  async deviceInventory(filters: {
    status?: string;
    departmentId?: string;
    categoryId?: string;
    deviceTypeId?: string;
    search?: string;
  }) {
    const where: any = {};

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        {
          items: {
            some: {
              serialNumber: {
                contains: filters.search,
                mode: 'insensitive',
              },
            },
          },
        },
      ];
    }
    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.deviceTypeId) {
      where.category = { deviceTypeId: filters.deviceTypeId };
    }

    let statusFilter: string | undefined;
    if (filters.status) statusFilter = filters.status;

    const devices = await this.prisma.device.findMany({
      where,
      include: {
        category: { include: { deviceType: true } },
        items: {
          include: {
            assignment: {
              include: {
                unit: {
                  include: {
                    division: { include: { department: true } },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter items by status if requested
    const result = devices.map((d) => ({
      ...d,
      items: statusFilter
        ? d.items.filter((item) => item.status === statusFilter)
        : d.items,
    }));

    // Filter by department if requested
    if (filters.departmentId) {
      return result.filter((d) =>
        d.items.some(
          (item) =>
            item.assignment?.unit?.division?.department?.id ===
            filters.departmentId,
        ),
      );
    }

    return result;
  }

  /** Maintenance history with full context, filterable */
  async maintenanceHistory(filters: {
    dateFrom?: string;
    dateTo?: string;
    departmentId?: string;
    technicianName?: string;
    status?: string;
    search?: string;
  }) {
    const where: any = {};

    if (filters.status) where.status = filters.status;
    if (filters.technicianName) {
      where.technicianName = {
        contains: filters.technicianName,
        mode: 'insensitive',
      };
    }
    if (filters.dateFrom || filters.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.date.lte = new Date(filters.dateTo);
    }
    if (filters.search) {
      where.OR = [
        { description: { contains: filters.search, mode: 'insensitive' } },
        { technicianName: { contains: filters.search, mode: 'insensitive' } },
        {
          item: {
            serialNumber: { contains: filters.search, mode: 'insensitive' },
          },
        },
      ];
    }

    // Filter by department requires a join
    if (filters.departmentId) {
      where.item = {
        ...(where.item || {}),
        assignment: {
          unit: {
            division: { departmentId: filters.departmentId },
          },
        },
      };
    }

    return this.prisma.maintenanceRecord.findMany({
      where,
      include: {
        item: {
          include: {
            device: { include: { category: { include: { deviceType: true } } } },
            assignment: {
              include: {
                unit: {
                  include: {
                    division: { include: { department: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 2000,
    });
  }

  /** Device transfer / assignment history */
  async deviceTransfers(filters: {
    dateFrom?: string;
    dateTo?: string;
    departmentId?: string;
    search?: string;
  }) {
    const where: any = {};

    if (filters.dateFrom || filters.dateTo) {
      where.assignedAt = {};
      if (filters.dateFrom) where.assignedAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.assignedAt.lte = new Date(filters.dateTo);
    }
    if (filters.departmentId) {
      where.unit = { division: { departmentId: filters.departmentId } };
    }
    if (filters.search) {
      where.OR = [
        {
          item: {
            serialNumber: {
              contains: filters.search,
              mode: 'insensitive',
            },
          },
        },
        {
          item: {
            device: {
              name: { contains: filters.search, mode: 'insensitive' },
            },
          },
        },
        { recipientName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.deviceAssignment.findMany({
      where,
      include: {
        item: {
          include: {
            device: { include: { category: { include: { deviceType: true } } } },
          },
        },
        unit: {
          include: { division: { include: { department: true } } },
        },
      },
      orderBy: { assignedAt: 'desc' },
      take: 2000,
    });
  }
}
