import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CategoriesService } from '../categories/categories.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { QueryDeviceDto } from './dto/query-device.dto';
import { AddItemsDto } from './dto/add-items.dto';
import { AssignItemDto } from './dto/assign-item.dto';
import { BulkImportDto } from './dto/bulk-import.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { UpdateDeviceItemDto } from './dto/update-device-item.dto';

const DEVICE_INCLUDE = {
  category: {
    include: {
      deviceType: true,
    },
  },
  items: {
    include: {
      assignment: {
        include: {
          unit: {
            include: {
              division: {
                include: { department: true },
              },
            },
          },
        },
      },
      _count: {
        select: { maintenanceRecords: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  },
  _count: {
    select: { items: true },
  },
} as const;

@Injectable()
export class DevicesService {
  constructor(
    private prisma: PrismaService,
    private activityLog: ActivityLogService,
    private categoriesService: CategoriesService,
  ) {}

  async findAll(query: QueryDeviceDto) {
    const {
      search,
      categoryId,
      deviceTypeId,
      departmentId,
      itemStatus,
      nature,
      dateFrom,
      dateTo,
      page = '1',
      limit = '20',
    } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Prisma.DeviceWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        {
          items: {
            some: {
              serialNumber: { contains: search, mode: 'insensitive' },
            },
          },
        },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (deviceTypeId) {
      where.category = { deviceTypeId };
    }
    if (nature) where.nature = nature;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const andFilters: Prisma.DeviceWhereInput[] = [];
    if (departmentId) {
      andFilters.push({
        items: {
          some: {
            assignment: {
              unit: { division: { departmentId } },
            },
          },
        },
      });
    }
    if (itemStatus) {
      andFilters.push({
        items: { some: { status: itemStatus } },
      });
    }
    if (andFilters.length) {
      const prev = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...prev, ...andFilters];
    }

    const [rawData, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        include: DEVICE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      this.prisma.device.count({ where }),
    ]);

    const data = rawData.map((d) => {
      const matchedSerial =
        search && d.items?.length
          ? d.items.find((i: any) =>
              i.serialNumber?.toLowerCase().includes(search.toLowerCase()),
            )?.serialNumber ?? null
          : null;
      return { ...d, matchedSerialNumber: matchedSerial };
    });

    return { data, total, page: Number(page), limit: Number(limit) };
  }

  findOne(id: string) {
    return this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: DEVICE_INCLUDE,
    });
  }

  async create(dto: CreateDeviceDto, actorName = 'غير معروف') {
    const { serialNumbers = [], ...rest } = dto;
    const created = await this.prisma.device.create({
      data: {
        ...rest,
        items: {
          create: serialNumbers
            .filter((s) => s.trim())
            .map((serialNumber) => ({ serialNumber: serialNumber.trim() })),
        },
      },
      include: DEVICE_INCLUDE,
    });
    void this.activityLog.log({
      userName: actorName,
      action: 'DEVICE_REGISTERED',
      entity: 'Device',
      entityId: created.id,
      details: { name: created.name, items: serialNumbers.length },
    });
    return created;
  }

  async update(id: string, dto: UpdateDeviceDto, actorName = 'غير معروف') {
    const updated = await this.prisma.device.update({
      where: { id },
      data: dto,
      include: DEVICE_INCLUDE,
    });
    void this.activityLog.log({
      userName: actorName,
      action: 'DEVICE_UPDATED',
      entity: 'Device',
      entityId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async remove(id: string, actorName = 'غير معروف') {
    void this.activityLog.log({
      userName: actorName,
      action: 'DEVICE_DELETED',
      entity: 'Device',
      entityId: id,
    });
    return this.prisma.device.delete({ where: { id } });
  }

  async addItems(deviceId: string, dto: AddItemsDto, actorName = 'غير معروف') {
    await this.prisma.deviceItem.createMany({
      data: dto.serialNumbers
        .filter((s) => s.trim())
        .map((serialNumber) => ({
          serialNumber: serialNumber.trim(),
          deviceId,
        })),
    });
    const device = await this.prisma.device.findUniqueOrThrow({
      where: { id: deviceId },
      include: DEVICE_INCLUDE,
    });
    void this.activityLog.log({
      userName: actorName,
      action: 'DEVICE_ITEMS_ADDED',
      entity: 'Device',
      entityId: deviceId,
      details: { count: dto.serialNumbers.filter((s) => s.trim()).length },
    });
    return device;
  }

  async removeItem(itemId: string, actorName = 'غير معروف') {
    void this.activityLog.log({
      userName: actorName,
      action: 'DEVICE_ITEM_DELETED',
      entity: 'DeviceItem',
      entityId: itemId,
    });
    return this.prisma.deviceItem.delete({ where: { id: itemId } });
  }

  async updateDeviceItem(
    itemId: string,
    dto: UpdateDeviceItemDto,
    actorName = 'غير معروف',
  ) {
    const data: Prisma.DeviceItemUpdateInput = {};
    if (dto.warrantyExpiry !== undefined) {
      data.warrantyExpiry =
        dto.warrantyExpiry === null || dto.warrantyExpiry === ''
          ? null
          : new Date(dto.warrantyExpiry);
    }
    if (dto.purchaseDate !== undefined) {
      data.purchaseDate =
        dto.purchaseDate === null || dto.purchaseDate === ''
          ? null
          : new Date(dto.purchaseDate);
    }
    if (dto.supplier !== undefined) data.supplier = dto.supplier;
    if (dto.contractDetails !== undefined)
      data.contractDetails = dto.contractDetails;

    const updated = await this.prisma.deviceItem.update({
      where: { id: itemId },
      data,
      include: {
        device: { include: { category: { include: { deviceType: true } } } },
        assignment: {
          include: {
            unit: {
              include: { division: { include: { department: true } } },
            },
          },
        },
      },
    });
    void this.activityLog.log({
      userName: actorName,
      action: 'DEVICE_ITEM_UPDATED',
      entity: 'DeviceItem',
      entityId: itemId,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async assignItem(
    itemId: string,
    dto: AssignItemDto,
    actorName = 'غير معروف',
  ) {
    const existing = await this.prisma.deviceAssignment.findUnique({
      where: { itemId },
    });
    if (existing) {
      await this.prisma.deviceAssignment.update({
        where: { itemId },
        data: {
          unitId: dto.unitId,
          recipientName: dto.recipientName ?? null,
          assignedAt: new Date(),
          returnedAt: null,
        },
      });
    } else {
      await this.prisma.deviceAssignment.create({
        data: {
          itemId,
          unitId: dto.unitId,
          recipientName: dto.recipientName,
        },
      });
    }
    await this.prisma.deviceItem.update({
      where: { id: itemId },
      data: { status: 'ASSIGNED' },
    });
    void this.activityLog.log({
      userName: actorName,
      action: 'DEVICE_TRANSFERRED',
      entity: 'DeviceItem',
      entityId: itemId,
      details: { unitId: dto.unitId, recipientName: dto.recipientName },
    });
    return this.prisma.deviceItem.findUniqueOrThrow({
      where: { id: itemId },
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
    });
  }

  async returnItem(itemId: string, actorName = 'غير معروف') {
    const assignment = await this.prisma.deviceAssignment.findUnique({
      where: { itemId },
    });
    if (assignment) {
      await this.prisma.deviceAssignment.update({
        where: { id: assignment.id },
        data: { returnedAt: new Date() },
      });
    }
    await this.prisma.deviceItem.update({
      where: { id: itemId },
      data: { status: 'AVAILABLE' },
    });
    void this.activityLog.log({
      userName: actorName,
      action: 'DEVICE_RETURNED',
      entity: 'DeviceItem',
      entityId: itemId,
    });
    return this.prisma.deviceItem.findUniqueOrThrow({
      where: { id: itemId },
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
    });
  }

  /** Fetch all items across devices for the maintenance combo */
  async findAllItems() {
    return this.prisma.deviceItem.findMany({
      include: {
        device: {
          include: {
            category: { include: { deviceType: true } },
          },
        },
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
      orderBy: { serialNumber: 'asc' },
    });
  }

  async bulkImport(dto: BulkImportDto, actorName = 'غير معروف') {
    const results: { serialNumber: string; deviceId?: string; error?: string }[] =
      [];

    // Pre-load all device types for fallback resolution
    const allTypes = await this.prisma.deviceType.findMany({ orderBy: { name: 'asc' } });
    const firstType = allTypes[0];

    for (const row of dto.rows) {
      const serial = row.serialNumber?.trim();
      const categoryName = row.categoryName?.trim();
      if (!serial || !categoryName) {
        results.push({
          serialNumber: serial ?? '',
          error: 'بيانات ناقصة',
        });
        continue;
      }
      try {
        // Resolve category by name
        let category = await this.categoriesService.findCategoryByName(categoryName);

        if (!category) {
          // Determine deviceTypeId
          let deviceTypeId: string | undefined;

          if (row.deviceTypeName?.trim()) {
            let deviceType = await this.categoriesService.findDeviceTypeByName(row.deviceTypeName.trim());
            if (!deviceType) {
              deviceType = await this.categoriesService.createDeviceTypeByName(row.deviceTypeName.trim());
            }
            deviceTypeId = deviceType.id;
          } else if (firstType) {
            deviceTypeId = firstType.id;
          }

          if (!deviceTypeId) {
            results.push({
              serialNumber: serial,
              error: 'لا يوجد نوع جهاز — حدد deviceTypeName أو أنشئ نوعاً أولاً',
            });
            continue;
          }

          category = await this.categoriesService.createCategoryByName(categoryName, deviceTypeId);
        }

        const device = await this.prisma.device.create({
          data: {
            name: row.name?.trim() || undefined,
            categoryId: category.id,
            nature: row.nature ?? 'FIXED',
            items: {
              create: [{ serialNumber: serial }],
            },
          },
          include: DEVICE_INCLUDE,
        });
        results.push({ serialNumber: serial, deviceId: device.id });
      } catch (e) {
        results.push({
          serialNumber: serial,
          error: 'فشل الإنشاء',
        });
      }
    }
    void this.activityLog.log({
      userName: actorName,
      action: 'DEVICES_BULK_IMPORTED',
      entity: 'Device',
      details: { count: dto.rows.length, ok: results.filter((r) => r.deviceId).length },
    });
    return { results };
  }

  async bulkAssign(dto: BulkAssignDto, actorName = 'غير معروف') {
    for (const itemId of dto.itemIds) {
      await this.assignItem(
        itemId,
        { unitId: dto.unitId, recipientName: dto.recipientName },
        actorName,
      );
    }
    void this.activityLog.log({
      userName: actorName,
      action: 'DEVICES_BULK_ASSIGNED',
      entity: 'DeviceAssignment',
      details: {
        count: dto.itemIds.length,
        unitId: dto.unitId,
      },
    });
    return { success: true, count: dto.itemIds.length };
  }
}
