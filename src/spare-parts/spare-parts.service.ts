import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateSparePartDto } from './dto/create-spare-part.dto';
import { UpdateSparePartDto } from './dto/update-spare-part.dto';

@Injectable()
export class SparePartsService {
  constructor(private prisma: PrismaService) {}

  findAll(search?: string) {
    return this.prisma.sparePart.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              {
                partNumber: { contains: search, mode: 'insensitive' },
              },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.sparePart.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('قطعة غير موجودة');
    return row;
  }

  async create(dto: CreateSparePartDto) {
    try {
      return await this.prisma.sparePart.create({
        data: {
          name: dto.name.trim(),
          partNumber: dto.partNumber?.trim(),
          quantity: dto.quantity ?? 0,
          minQuantity: dto.minQuantity ?? 5,
          category: dto.category?.trim(),
          notes: dto.notes?.trim(),
        },
      });
    } catch {
      throw new ConflictException('اسم القطعة موجود مسبقاً');
    }
  }

  async update(id: string, dto: UpdateSparePartDto) {
    await this.findOne(id);
    return this.prisma.sparePart.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.partNumber !== undefined ? { partNumber: dto.partNumber } : {}),
        ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
        ...(dto.minQuantity !== undefined ? { minQuantity: dto.minQuantity } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.sparePart.delete({ where: { id } });
  }

  async lowStock() {
    const all = await this.prisma.sparePart.findMany({ orderBy: { name: 'asc' } });
    return all.filter((p) => p.quantity < p.minQuantity);
  }

  async useStock(
    sparePartId: string,
    quantityUsed: number,
    maintenanceId?: string,
  ) {
    if (!Number.isFinite(quantityUsed) || quantityUsed <= 0) {
      throw new ConflictException('كمية غير صالحة');
    }
    const part = await this.findOne(sparePartId);
    if (part.quantity < quantityUsed) {
      throw new ConflictException('الكمية المتوفرة غير كافية');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.sparePart.update({
        where: { id: sparePartId },
        data: { quantity: { decrement: quantityUsed } },
      });
      if (maintenanceId) {
        await tx.sparePartUsage.create({
          data: {
            sparePartId,
            maintenanceId,
            quantityUsed,
          },
        });
      }
      return updated;
    });
  }

  /** Match catalog parts by name or partNumber and deduct stock; link usages to maintenance record. */
  async applyPartsFromMaintenanceRecord(
    maintenanceId: string,
    partsUsed: unknown,
  ) {
    if (!Array.isArray(partsUsed)) return;
    for (const raw of partsUsed) {
      if (!raw || typeof raw !== 'object') continue;
      const name = String((raw as { name?: string }).name ?? '').trim();
      const qty = Number((raw as { quantity?: number }).quantity);
      if (!name || !Number.isFinite(qty) || qty <= 0) continue;

      const part = await this.prisma.sparePart.findFirst({
        where: {
          OR: [
            { name: { equals: name, mode: 'insensitive' } },
            { partNumber: { equals: name, mode: 'insensitive' } },
          ],
        },
      });
      if (!part) continue;
      await this.useStock(part.id, qty, maintenanceId);
    }
  }
}
