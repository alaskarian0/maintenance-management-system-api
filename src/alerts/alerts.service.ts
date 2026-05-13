import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AccessDeviceSyncService } from '../access-control/access-device-sync.service';
import { SparePartsService } from '../spare-parts/spare-parts.service';

export interface ExpiredAccessAlert {
  personId: string;
  name: string;
  personType: string;
  accessEndDate: string;
  doors: string[];
  isActive: boolean;
}

export interface LowStockAlert {
  id: string;
  name: string;
  partNumber: string | null;
  quantity: number;
  minQuantity: number;
  category: string | null;
}

export interface AllAlerts {
  expiredAccess: ExpiredAccessAlert[];
  lowStockParts: LowStockAlert[];
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private prisma: PrismaService,
    private sync: AccessDeviceSyncService,
    private sparePartsService: SparePartsService,
  ) {}

  async getAllAlerts(): Promise<AllAlerts> {
    const [expiredAccess, lowStockParts] = await Promise.all([
      this.getExpiredAccess(),
      this.getLowStockParts(),
    ]);
    return { expiredAccess, lowStockParts };
  }

  async getExpiredAccess(): Promise<ExpiredAccessAlert[]> {
    const persons = await this.prisma.accessPerson.findMany({
      where: {
        accessType: 'temporary',
        accessEndDate: { lte: new Date() },
        isActive: true,
        deletedAt: null,
      },
      include: {
        permissions: {
          include: {
            door: { select: { name: true } },
          },
        },
      },
      orderBy: { accessEndDate: 'asc' },
    });

    return persons.map((p) => ({
      personId: p.id,
      name: p.name,
      personType: p.personType,
      accessEndDate: p.accessEndDate!.toISOString(),
      doors: p.permissions.map((perm) => perm.door.name),
      isActive: p.isActive,
    }));
  }

  async getLowStockParts(): Promise<LowStockAlert[]> {
    const parts = await this.sparePartsService.lowStock();
    return parts.map((p) => ({
      id: p.id,
      name: p.name,
      partNumber: p.partNumber,
      quantity: p.quantity,
      minQuantity: p.minQuantity,
      category: p.category,
    }));
  }

  async stopExpiredAccess(personId: string) {
    const person = await this.prisma.accessPerson.findUnique({
      where: { id: personId },
    });
    if (!person) throw new NotFoundException('الشخص غير موجود');
    if (!person.isActive) throw new NotFoundException('الشخص غير مفعل بالفعل');

    await this.prisma.accessPerson.update({
      where: { id: personId },
      data: { isActive: false },
    });

    setImmediate(async () => {
      try {
        const result = await this.sync.removeFromAllDevices({
          ...person,
          isActive: false,
        });
        this.logger.log(
          `Stopped access for "${person.name}": ${result.success} success, ${result.failed} failed`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to remove "${person.name}" from devices: ${err instanceof Error ? err.message : err}`,
        );
      }
    });

    return { success: true, personId };
  }
}
