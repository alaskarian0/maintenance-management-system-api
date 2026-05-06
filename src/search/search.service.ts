import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async global(q: string) {
    const term = q.trim();
    if (!term) {
      return { devices: [], maintenance: [], spareParts: [] };
    }

    const [devices, maintenance, spareParts] = await Promise.all([
      this.prisma.device.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            {
              items: {
                some: {
                  serialNumber: { contains: term, mode: 'insensitive' },
                },
              },
            },
          ],
        },
        take: 15,
        select: {
          id: true,
          name: true,
          category: { select: { name: true } },
        },
      }),
      this.prisma.maintenanceRecord.findMany({
        where: {
          OR: [
            { description: { contains: term, mode: 'insensitive' } },
            { technicianName: { contains: term, mode: 'insensitive' } },
            {
              item: {
                serialNumber: { contains: term, mode: 'insensitive' },
              },
            },
          ],
        },
        take: 15,
        orderBy: { date: 'desc' },
        select: {
          id: true,
          description: true,
          status: true,
          date: true,
          technicianName: true,
          item: { select: { serialNumber: true, deviceId: true } },
        },
      }),
      this.prisma.sparePart.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            {
              partNumber: { contains: term, mode: 'insensitive' },
            },
          ],
        },
        take: 15,
        select: { id: true, name: true, partNumber: true, quantity: true },
      }),
    ]);

    return {
      devices,
      maintenance: maintenance.map((m) => ({
        ...m,
        date: m.date.toISOString(),
      })),
      spareParts,
    };
  }
}
