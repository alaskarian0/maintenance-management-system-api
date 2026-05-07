import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AccessFallbackService, DeviceUserInfo } from './access-fallback.service';
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
export class AccessPersonService {
  private readonly logger = new Logger(AccessPersonService.name);
  private residentsCache: ResidentEntry[] | null = null;
  private residentsCacheAt = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private fallback: AccessFallbackService,
  ) {}

  async findAll(personType?: string, isActive?: boolean) {
    const where: Record<string, unknown> = {};
    if (personType) where.personType = personType;
    if (isActive !== undefined) where.isActive = isActive;

    return this.prisma.accessPerson.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { permissions: true } },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.accessPerson.findUnique({
      where: { id },
      include: {
        permissions: { include: { door: true } },
      },
    });
  }

  async create(data: {
    personType: 'EMPLOYEE' | 'RESIDENT';
    name: string;
    personId?: number;
    empCode?: string;
    region?: string;
    note?: string;
    phone?: string;
  }) {
    return this.prisma.accessPerson.create({ data });
  }

  async update(
    id: string,
    data: { name?: string; region?: string; note?: string; phone?: string; isActive?: boolean },
  ) {
    return this.prisma.accessPerson.update({ where: { id }, data });
  }

  async remove(id: string) {
    return this.prisma.accessPerson.delete({ where: { id } });
  }

  async getPersonDoors(personId: string) {
    return this.prisma.accessPermission.findMany({
      where: { personId },
      include: { door: true },
    });
  }

  async syncBiometricStatus(): Promise<{ updated: number; details: string[] }> {
    const details: string[] = [];
    let updated = 0;

    try {
      const persons = await this.prisma.accessPerson.findMany({
        where: { empCode: { not: null }, isActive: true },
      });

      if (persons.length === 0) {
        details.push('لا يوجد أشخاص برقم موظف للمزامنة');
        return { updated: 0, details };
      }

      const doors = await this.prisma.accessDoor.findMany({ where: { state: 1 } });

      for (const person of persons) {
        let found = false;

        for (const door of doors) {
          if (!door.ipAddress) continue;

          try {
            const users = await this.fallback.getDeviceUsers(door.ipAddress);
            const match = users.find(
              (u) => u.userId === person.empCode || u.uid === person.personId,
            );

            if (match) {
              await this.prisma.accessPerson.update({
                where: { id: person.id },
                data: {
                  personId: match.uid,
                  fingerprintStatus: 'enrolled',
                  lastSyncAt: new Date(),
                },
              });
              details.push(`${person.name}: مسجّل على ${door.name} (UID: ${match.uid})`);
              found = true;
              break;
            }
          } catch {
            // Skip this device
          }
        }

        if (!found) {
          await this.prisma.accessPerson.update({
            where: { id: person.id },
            data: {
              fingerprintStatus: 'not_pushed',
              lastSyncAt: new Date(),
            },
          });
          details.push(`${person.name}: غير موجود على أي جهاز`);
        }
        updated++;
      }
    } catch (err) {
      this.logger.warn(`Biometric sync failed: ${err instanceof Error ? err.message : err}`);
      details.push('فشلت مزامنة الجهاز');
    }

    return { updated, details };
  }

  async syncFromDevice(doorId: string): Promise<{ synced: number; created: number; updated: number; details: string[] }> {
    const details: string[] = [];
    let created = 0;
    let updated = 0;

    const door = await this.prisma.accessDoor.findUnique({ where: { id: doorId } });
    if (!door) {
      throw new NotFoundException(`Door ${doorId} not found`);
    }
    if (!door.ipAddress) {
      throw new NotFoundException(`Door "${door.name}" has no IP address configured`);
    }

    const deviceUsers: DeviceUserInfo[] = await this.fallback.getDeviceUsers(door.ipAddress);
    if (deviceUsers.length === 0) {
      details.push(`لا يوجد مستخدمين على الجهاز ${door.ipAddress}`);
      return { synced: 0, created: 0, updated: 0, details };
    }

    details.push(`تم العثور على ${deviceUsers.length} مستخدم على جهاز ${door.name} (${door.ipAddress})`);

    for (const deviceUser of deviceUsers) {
      const existingPerson = await this.prisma.accessPerson.findFirst({
        where: {
          OR: [
            { personId: deviceUser.uid },
            { name: deviceUser.name },
          ],
        },
      });

      if (!existingPerson) {
        await this.prisma.accessPerson.create({
          data: {
            personType: 'EMPLOYEE',
            name: deviceUser.name || `User ${deviceUser.uid}`,
            personId: deviceUser.uid,
            empCode: deviceUser.userId || String(deviceUser.uid),
            fingerprintStatus: 'enrolled',
            lastSyncAt: new Date(),
          },
        });
        details.push(`جديد: ${deviceUser.name} (UID: ${deviceUser.uid})`);
        created++;
      } else {
        const nameChanged = deviceUser.name && deviceUser.name !== existingPerson.name;
        await this.prisma.accessPerson.update({
          where: { id: existingPerson.id },
          data: {
            ...(nameChanged ? { name: deviceUser.name } : {}),
            fingerprintStatus: 'enrolled',
            lastSyncAt: new Date(),
          },
        });
        details.push(`محدّث: ${deviceUser.name || existingPerson.name} (UID: ${deviceUser.uid})${nameChanged ? ' — تم تغيير الاسم' : ''}`);
        updated++;
      }
    }

    return { synced: deviceUsers.length, created, updated, details };
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
    return doc.data.filter((emp) => {
      const name = emp['الإسم الرباعي']?.toLowerCase() || '';
      const id = String(emp['تسلسل الموظف'] || '');
      return name.includes(q) || id.includes(q);
    });
  }

  async searchResidents(query: string): Promise<ResidentEntry[]> {
    const residents = await this.getResidents();

    if (!query || query.trim().length < 1) {
      return residents;
    }

    const q = query.trim().toLowerCase();
    return residents.filter((r) => {
      const name = r.fullName?.toLowerCase() || '';
      const id = String(r.id);
      const phone = r.phoneNumber?.toLowerCase() || '';
      return name.includes(q) || id.includes(q) || phone.includes(q);
    });
  }

  private async getResidents(): Promise<ResidentEntry[]> {
    const now = Date.now();
    if (this.residentsCache && now - this.residentsCacheAt < this.CACHE_TTL) {
      return this.residentsCache;
    }

    const apiUrl = process.env.RESIDENTS_API_URL;
    const apiKey = process.env.RESIDENTS_API_KEY;

    if (!apiUrl || !apiKey) {
      return this.residentsCache ?? [];
    }

    try {
      const res = await fetch(apiUrl, {
        headers: { 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) return this.residentsCache ?? [];

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
    } catch {
      return this.residentsCache ?? [];
    }
  }
}
