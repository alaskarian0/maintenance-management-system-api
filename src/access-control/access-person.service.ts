import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AccessFallbackService, DeviceUserInfo } from './access-fallback.service';
import { QueryPersonDto } from './dto/query-person.dto';
import * as fs from 'fs';
import * as path from 'path';

export interface EmployeeEntry {
  'تسلسل الموظف': number;
  'الإسم الرباعي': string;
  'الهيكلية': string;
  'الوجبة': string | null;
}

interface PendingDeviceOp {
  personId: string;
  personName: string;
  type: 'block' | 'push' | 'update';
  doorId: string;
  doorName: string;
  doorIp: string;
  uid: number;
  empCode: string;
  createdAt: Date;
  retries: number;
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
  private pendingOps: PendingDeviceOp[] = [];

  constructor(
    private prisma: PrismaService,
    private fallback: AccessFallbackService,
  ) {}

  get pendingOperations() {
    return [...this.pendingOps];
  }

  async findAll(query: QueryPersonDto) {
    const {
      search,
      personType,
      isActive,
      page = '1',
      limit = '20',
    } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Prisma.AccessPersonWhereInput = {};

    if (personType) {
      where.personType = personType;
    }
    if (isActive === 'true') {
      where.isActive = true;
    } else if (isActive === 'false') {
      where.isActive = false;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { empCode: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.accessPerson.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { permissions: true } },
        },
        skip,
        take: Number(limit),
      }),
      this.prisma.accessPerson.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
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
    const person = await this.prisma.accessPerson.findUnique({ where: { id } });
    if (!person) throw new NotFoundException('Person not found');

    const wasActive = person.isActive;
    const willBeActive = data.isActive ?? wasActive;

    const updated = await this.prisma.accessPerson.update({ where: { id }, data });

    let deviceSync: { success: number; failed: number; details: string[] } = { success: 0, failed: 0, details: [] };

    // If active status changed, sync with physical devices
    if (wasActive && !willBeActive) {
      deviceSync = await this.removeFromAllDevices(person);
    } else if (!wasActive && willBeActive) {
      deviceSync = await this.pushToPermittedDevices(updated);
    } else if (willBeActive && (data.name)) {
      // Name changed while active — update on devices
      deviceSync = await this.updateOnAllDevices(updated);
    }

    return { ...updated, _deviceSync: deviceSync };
  }

  private async removeFromAllDevices(person: { id: string; personId: number | null; name: string }): Promise<{ success: number; failed: number; details: string[] }> {
    const allDoors = await this.prisma.accessDoor.findMany();
    const onlineDoors = allDoors.filter(d => d.state === 1 && d.ipAddress);
    const offlineDoors = allDoors.filter(d => d.state !== 1 && d.ipAddress);
    const uid = person.personId || 0;
    let success = 0;
    let failed = 0;
    const details: string[] = [];

    // Process online devices
    for (const door of onlineDoors) {
      try {
        const removed = await this.fallback.deleteUserFromDevice(door.ipAddress!, uid, person.name);
        if (removed) {
          success++;
          this.logger.log(`Blocked "${person.name}" on device ${door.name} (${door.ipAddress})`);
        } else {
          failed++;
          details.push(`فشل الحظر على ${door.name}`);
          this.enqueueOp({ personId: person.id, personName: person.name, type: 'block', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode: '', createdAt: new Date(), retries: 0 });
        }
      } catch {
        failed++;
        details.push(`خطأ على ${door.name}`);
        this.enqueueOp({ personId: person.id, personName: person.name, type: 'block', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode: '', createdAt: new Date(), retries: 0 });
      }
    }

    // Queue offline devices for retry
    for (const door of offlineDoors) {
      details.push(`${door.name} غير متصل — سيتم عند الاتصال`);
      this.enqueueOp({ personId: person.id, personName: person.name, type: 'block', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode: '', createdAt: new Date(), retries: 0 });
    }

    return { success, failed, details };
  }

  private async pushToPermittedDevices(person: { id: string; personId: number | null; empCode: string | null; name: string }): Promise<{ success: number; failed: number; details: string[] }> {
    const permissions = await this.prisma.accessPermission.findMany({
      where: { personId: person.id },
      include: { door: true },
    });

    const empCode = person.empCode || `P${person.personId || Date.now()}`;
    const uid = person.personId || Math.abs(person.id.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));

    const doorsToPush = permissions.length > 0
      ? permissions.map((p) => p.door).filter((d) => d?.ipAddress)
      : await this.prisma.accessDoor.findMany({ where: { state: 1 } });

    let success = 0;
    let failed = 0;
    const details: string[] = [];

    for (const door of doorsToPush) {
      if (!door?.ipAddress) continue;
      if (door.state !== 1) {
        details.push(`${door.name} غير متصل — سيتم عند الاتصال`);
        this.enqueueOp({ personId: person.id, personName: person.name, type: 'push', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode, createdAt: new Date(), retries: 0 });
        continue;
      }
      try {
        const pushed = await this.fallback.pushUserToDevice(door.ipAddress, uid, empCode, person.name);
        if (pushed) {
          success++;
          this.logger.log(`Pushed "${person.name}" to device ${door.name} (${door.ipAddress})`);
        } else {
          failed++;
          details.push(`فشل الإرسال إلى ${door.name}`);
          this.enqueueOp({ personId: person.id, personName: person.name, type: 'push', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode, createdAt: new Date(), retries: 0 });
        }
      } catch {
        failed++;
        details.push(`خطأ على ${door.name}`);
        this.enqueueOp({ personId: person.id, personName: person.name, type: 'push', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode, createdAt: new Date(), retries: 0 });
      }
    }

    return { success, failed, details };
  }

  private async updateOnAllDevices(person: { id: string; personId: number | null; empCode: string | null; name: string; isActive: boolean }): Promise<{ success: number; failed: number; details: string[] }> {
    if (!person.isActive) return { success: 0, failed: 0, details: [] };

    const allDoors = await this.prisma.accessDoor.findMany();
    const uid = person.personId || 0;
    const empCode = person.empCode || String(uid);
    let success = 0;
    let failed = 0;
    const details: string[] = [];

    for (const door of allDoors) {
      if (!door.ipAddress) continue;
      if (door.state !== 1) {
        details.push(`${door.name} غير متصل — سيتم عند الاتصال`);
        this.enqueueOp({ personId: person.id, personName: person.name, type: 'update', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode, createdAt: new Date(), retries: 0 });
        continue;
      }
      try {
        const pushed = await this.fallback.pushUserToDevice(door.ipAddress, uid, empCode, person.name);
        if (pushed) {
          success++;
          this.logger.log(`Updated "${person.name}" on device ${door.name} (${door.ipAddress})`);
        } else {
          failed++;
          details.push(`فشل التحديث على ${door.name}`);
          this.enqueueOp({ personId: person.id, personName: person.name, type: 'update', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode, createdAt: new Date(), retries: 0 });
        }
      } catch {
        failed++;
        details.push(`خطأ على ${door.name}`);
        this.enqueueOp({ personId: person.id, personName: person.name, type: 'update', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode, createdAt: new Date(), retries: 0 });
      }
    }

    return { success, failed, details };
  }

  private enqueueOp(op: PendingDeviceOp) {
    // Avoid duplicates for same person+door+type
    const exists = this.pendingOps.find(
      (p) => p.personId === op.personId && p.doorId === op.doorId && p.type === op.type,
    );
    if (!exists) {
      this.pendingOps.push(op);
      this.logger.warn(`Queued ${op.type} for "${op.personName}" on ${op.doorName} (offline)`);
    }
  }

  async retryPendingOperations(): Promise<{ retried: number; succeeded: number; removed: number }> {
    if (this.pendingOps.length === 0) return { retried: 0, succeeded: 0, removed: 0 };

    this.logger.log(`Retrying ${this.pendingOps.length} pending device operations...`);
    const remaining: PendingDeviceOp[] = [];
    let succeeded = 0;
    let removed = 0;

    for (const op of this.pendingOps) {
      // Check if device is now online
      const door = await this.prisma.accessDoor.findUnique({ where: { id: op.doorId } });
      if (!door || door.state !== 1) {
        op.retries++;
        if (op.retries > 20) {
          removed++;
          this.logger.warn(`Dropping stale ${op.type} for "${op.personName}" on ${op.doorName} (too many retries)`);
          continue;
        }
        remaining.push(op);
        continue;
      }

      // Check if person still exists and is active (for push/update)
      const person = await this.prisma.accessPerson.findUnique({ where: { id: op.personId } });

      try {
        let ok = false;
        if (op.type === 'block') {
          ok = await this.fallback.deleteUserFromDevice(op.doorIp, op.uid, op.personName);
        } else if (op.type === 'push' || op.type === 'update') {
          if (!person || !person.isActive) {
            removed++;
            continue;
          }
          ok = await this.fallback.pushUserToDevice(op.doorIp, op.uid, op.empCode, person.name);
        }

        if (ok) {
          succeeded++;
          this.logger.log(`Retry ${op.type} succeeded for "${op.personName}" on ${op.doorName}`);
        } else {
          op.retries++;
          if (op.retries > 20) {
            removed++;
          } else {
            remaining.push(op);
          }
        }
      } catch {
        op.retries++;
        if (op.retries > 20) {
          removed++;
        } else {
          remaining.push(op);
        }
      }
    }

    this.pendingOps = remaining;
    return { retried: this.pendingOps.length + succeeded + removed, succeeded, removed };
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
