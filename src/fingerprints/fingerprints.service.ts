import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateFingerprintDto } from './dto/create-fingerprint.dto';
import { UpdateFingerprintDto } from './dto/update-fingerprint.dto';
import * as fs from 'fs';
import * as path from 'path';

export interface EmployeeEntry {
  'تسلسل الموظف': number;
  'الإسم الرباعي': string;
  'الهيكلية': string;
  'الوجبة': string | null;
}

export interface ResidentEntry {
  id: number;
  fullName: string;
  dateOfBirth: string | null;
  gender: string | null;
  phoneNumber: string | null;
  notes: string;
  kinship: string;
  familyId: number;
  familyAddress: string;
}

interface EmployeesJson {
  name: string;
  headers: string[];
  data: EmployeeEntry[];
}

interface FamilyMember {
  id: number;
  familyID: number;
  fullName: string;
  motherName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phoneNumber: string | null;
  notes: string;
  kinship: number;
  kinshipRelation: { id: number; title: string } | null;
  deletedAt?: string | null;
}

interface Family {
  id: number;
  currentResidentialAddress: string;
  propertyType: string;
  status: boolean;
  familyMembers: FamilyMember[];
}

interface FamiliesResponse {
  status: string;
  totalFamilies: number;
  data: Family[];
}

@Injectable()
export class FingerprintsService {
  private residentsCache: ResidentEntry[] | null = null;
  private residentsCacheAt = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private prisma: PrismaService) {}

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
    const jsonPath = path.join(
      process.cwd(),
      'prisma',
      'data',
      'employes2.json',
    );
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const doc = JSON.parse(raw) as EmployeesJson;

    if (!query || query.trim().length < 1) {
      return doc.data;
    }

    const q = query.trim().toLowerCase();
    const results = doc.data.filter((emp) => {
      const name = emp['الإسم الرباعي']?.toLowerCase() || '';
      const id = String(emp['تسلسل الموظف'] || '');
      return name.includes(q) || id.includes(q);
    });

    return results;
  }

  async searchResidents(query: string): Promise<ResidentEntry[]> {
    const residents = await this.getResidents();

    if (!query || query.trim().length < 1) {
      return residents;
    }

    const q = query.trim().toLowerCase();
    const results = residents.filter((r) => {
      const name = r.fullName?.toLowerCase() || '';
      const id = String(r.id);
      const phone = r.phoneNumber?.toLowerCase() || '';
      return name.includes(q) || id.includes(q) || phone.includes(q);
    });

    return results;
  }

  private async getResidents(): Promise<ResidentEntry[]> {
    const now = Date.now();
    if (this.residentsCache && now - this.residentsCacheAt < this.CACHE_TTL) {
      return this.residentsCache;
    }

    const apiUrl = process.env.RESIDENTS_API_URL;
    const apiKey = process.env.RESIDENTS_API_KEY;

    if (!apiUrl || !apiKey) {
      console.warn(
        '[FingerprintsService] RESIDENTS_API_URL / RESIDENTS_API_KEY not configured – returning empty list',
      );
      return this.residentsCache ?? [];
    }

    let res: Response;
    try {
      res = await fetch(apiUrl, {
        headers: { 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      console.warn(
        '[FingerprintsService] Residents API unreachable – returning cached or empty list:',
        err instanceof Error ? err.message : err,
      );
      return this.residentsCache ?? [];
    }

    if (!res.ok) {
      console.warn(
        `[FingerprintsService] Residents API returned ${res.status} – returning cached or empty list`,
      );
      return this.residentsCache ?? [];
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.warn(
        `[FingerprintsService] Residents API returned non-JSON response (${contentType}) – returning cached or empty list`,
      );
      return this.residentsCache ?? [];
    }

    const json = (await res.json()) as FamiliesResponse;

    const residents: ResidentEntry[] = [];
    for (const family of json.data) {
      for (const member of family.familyMembers) {
        if (member.deletedAt) continue;
        residents.push({
          id: member.id,
          fullName: member.fullName || '',
          dateOfBirth: member.dateOfBirth,
          gender: member.gender,
          phoneNumber: member.phoneNumber,
          notes: member.notes || '',
          kinship: member.kinshipRelation?.title || '',
          familyId: family.id,
          familyAddress: family.currentResidentialAddress || '',
        });
      }
    }

    this.residentsCache = residents;
    this.residentsCacheAt = now;
    return residents;
  }
}
