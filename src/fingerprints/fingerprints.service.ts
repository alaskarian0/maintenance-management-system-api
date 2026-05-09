import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateFingerprintDto } from './dto/create-fingerprint.dto';
import { UpdateFingerprintDto } from './dto/update-fingerprint.dto';
import {
  PersonSearchService,
  EmployeeEntry,
  ResidentEntry,
} from '../common/person-search.service';

export { EmployeeEntry, ResidentEntry };

@Injectable()
export class FingerprintsService {
  constructor(
    private prisma: PrismaService,
    private personSearch: PersonSearchService,
  ) {}

  async findAll(personType?: string) {
    const where = personType ? { personType: personType as any } : {};
    const records = await this.prisma.fingerprintRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const accessPersons = await this.prisma.accessPerson.findMany({
      where: { deletedAt: null },
      select: {
        personType: true,
        personId: true,
        id: true,
        fingerprintStatus: true,
        isActive: true,
      },
    });

    const accessMap = new Map<
      string,
      {
        id: string;
        fingerprintStatus: string;
        isActive: boolean;
      }
    >();
    for (const ap of accessPersons) {
      if (ap.personId)
        accessMap.set(`${ap.personType}:${ap.personId}`, {
          id: ap.id,
          fingerprintStatus: ap.fingerprintStatus,
          isActive: ap.isActive,
        });
    }

    return records.map((r) => ({
      ...r,
      accessControl:
        r.personId != null
          ? accessMap.get(`${r.personType}:${r.personId}`) ?? null
          : null,
    }));
  }

  create(dto: CreateFingerprintDto) {
    return this.prisma.fingerprintRecord.create({
      data: {
        personType: dto.personType,
        name: dto.name,
        personId: dto.personId,
        region: dto.region,
        note: dto.note,
      },
    });
  }

  update(id: string, dto: UpdateFingerprintDto) {
    return this.prisma.fingerprintRecord.update({
      where: { id },
      data: dto,
    });
  }

  remove(id: string) {
    return this.prisma.fingerprintRecord.delete({ where: { id } });
  }

  searchEmployees(query: string): EmployeeEntry[] {
    return this.personSearch.searchEmployees(query);
  }

  async searchResidents(query: string): Promise<ResidentEntry[]> {
    return this.personSearch.searchResidents(query);
  }
}
