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

  async findAll(query: {
    page?: string;
    limit?: string;
    personType?: string;
    search?: string;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.personType) {
      where.personType = query.personType;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { region: { contains: query.search, mode: 'insensitive' } },
        { note: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [records, total] = await Promise.all([
      this.prisma.fingerprintRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.fingerprintRecord.count({ where }),
    ]);

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

    // Fetch letter counts for all persons in the result set
    const personsWithId = records.filter((r) => r.personId != null);
    const letterCountMap = new Map<string, number>();

    if (personsWithId.length > 0) {
      const personConditions = personsWithId.map((r) => ({
        personType: r.personType,
        personId: r.personId!,
      }));

      const letterCounts = await this.prisma.adminLetterPerson.groupBy({
        by: ['personType', 'personId'],
        where: {
          OR: personConditions,
        },
        _count: { id: true },
      });

      for (const lc of letterCounts) {
        letterCountMap.set(`${lc.personType}:${lc.personId}`, lc._count.id);
      }
    }

    const data = records.map((r) => ({
      ...r,
      accessControl:
        r.personId != null
          ? accessMap.get(`${r.personType}:${r.personId}`) ?? null
          : null,
      lettersCount:
        r.personId != null
          ? letterCountMap.get(`${r.personType}:${r.personId}`) ?? 0
          : 0,
    }));

    return { data, total, page, limit };
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
