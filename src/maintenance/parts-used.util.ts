import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PartUsedDto } from './dto/create-maintenance-record.dto';

export function normalizePartsUsed(
  raw: unknown,
): Prisma.InputJsonValue | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new BadRequestException('partsUsed must be an array');
  }
  const out: PartUsedDto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as PartUsedDto).name ?? '').trim();
    const quantity = Number((item as PartUsedDto).quantity);
    if (!name) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException(
        `Invalid quantity for part "${name}": must be a positive number`,
      );
    }
    out.push({ name, quantity });
  }
  return out;
}
