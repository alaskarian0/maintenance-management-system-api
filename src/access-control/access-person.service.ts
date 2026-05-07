import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AccessFallbackService, DeviceUserInfo } from './access-fallback.service';
import { AccessBiometricService } from './access-biometric.service';
import { QueryPersonDto } from './dto/query-person.dto';
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
    private biometric: AccessBiometricService,
  ) {}

  async findAll(query: QueryPersonDto) {
    const {
      search,
      personType,
      isActive,
      page = '1',
      limit = '20',
    } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Prisma.AccessPersonWhereInput = {
      deletedAt: null,
    };

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

  private async removeFromAllDevices(person: { id: string; personId: number | null; empCode: string | null; name: string }): Promise<{ success: number; failed: number; details: string[] }> {
    const permissions = await this.prisma.accessPermission.findMany({
      where: { personId: person.id },
      include: { door: true },
    });

    const permittedDoors = permissions.map(p => p.door).filter(d => d?.ipAddress);
    const uid = person.personId || 0;
    let success = 0;
    let failed = 0;
    const details: string[] = [];

    const onlineDoors = permittedDoors.filter(d => d!.state === 1);
    const offlineDoors = permittedDoors.filter(d => d!.state !== 1);

    // Process online permitted devices
    for (const door of onlineDoors) {
      try {
        // Save biometric templates before blocking (best-effort)
        try {
          const pulled = await this.biometric.pullAndStoreTemplates(person.id, door.ipAddress!);
          if (pulled.fingers > 0) {
            this.logger.log(`Saved ${pulled.fingers} fingerprint templates from ${door.name} before blocking`);
          }
        } catch (err) {
          this.logger.warn(`Failed to pull templates from ${door.name}: ${err instanceof Error ? err.message : err}`);
        }

        const removed = await this.fallback.deleteUserFromDevice(door.ipAddress!, uid, person.name, person.empCode || undefined);
        if (removed) {
          success++;
          this.logger.log(`Blocked "${person.name}" on device ${door.name} (${door.ipAddress})`);
        } else {
          failed++;
          details.push(`فشل الحظر على ${door.name}`);
          await this.enqueueOp({ personId: person.id, personName: person.name, type: 'block', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode: '' });
        }
      } catch {
        failed++;
        details.push(`خطأ على ${door.name}`);
        await this.enqueueOp({ personId: person.id, personName: person.name, type: 'block', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode: '' });
      }
    }

    // Queue offline permitted devices for retry
    for (const door of offlineDoors) {
      details.push(`${door.name} غير متصل — سيتم عند الاتصال`);
      await this.enqueueOp({ personId: person.id, personName: person.name, type: 'block', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode: '' });
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

    if (permissions.length === 0) {
      return { success: 0, failed: 0, details: ['لا توجد أبواب مصرح بها — حدد الأبواب أولاً'] };
    }

    const doorsToPush = permissions.map((p) => p.door).filter((d) => d?.ipAddress);

    let success = 0;
    let failed = 0;
    const details: string[] = [];

    for (const door of doorsToPush) {
      if (!door?.ipAddress) continue;
      if (door.state !== 1) {
        details.push(`${door.name} غير متصل — سيتم عند الاتصال`);
        await this.enqueueOp({ personId: person.id, personName: person.name, type: 'push', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode });
        continue;
      }
      try {
        const pushed = await this.fallback.pushUserToDevice(door.ipAddress, uid, empCode, person.name);
        if (pushed) {
          success++;
          this.logger.log(`Pushed "${person.name}" to device ${door.name} (${door.ipAddress})`);

          // Restore biometric templates (best-effort)
          try {
            const restored = await this.biometric.restoreTemplates(person.id, door.ipAddress!);
            if (restored.fingers > 0) {
              this.logger.log(`Restored ${restored.fingers} fingerprints for "${person.name}" on ${door.name}`);
            }
          } catch (err) {
            this.logger.warn(`Failed to restore templates on ${door.name}: ${err instanceof Error ? err.message : err}`);
          }
        } else {
          failed++;
          details.push(`فشل الإرسال إلى ${door.name}`);
          await this.enqueueOp({ personId: person.id, personName: person.name, type: 'push', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode });
        }
      } catch {
        failed++;
        details.push(`خطأ على ${door.name}`);
        await this.enqueueOp({ personId: person.id, personName: person.name, type: 'push', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode });
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
        await this.enqueueOp({ personId: person.id, personName: person.name, type: 'update', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode });
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
          await this.enqueueOp({ personId: person.id, personName: person.name, type: 'update', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode });
        }
      } catch {
        failed++;
        details.push(`خطأ على ${door.name}`);
        await this.enqueueOp({ personId: person.id, personName: person.name, type: 'update', doorId: door.id, doorName: door.name, doorIp: door.ipAddress!, uid, empCode });
      }
    }

    return { success, failed, details };
  }

  private async enqueueOp(op: { personId: string; personName: string; type: 'block' | 'push' | 'update'; doorId: string; doorName: string; doorIp: string; uid: number; empCode: string }) {
    const existing = await this.prisma.pendingDeviceOp.findFirst({
      where: { personId: op.personId, doorId: op.doorId, type: op.type, status: { in: ['pending', 'in_progress'] } },
    });
    if (!existing) {
      await this.prisma.pendingDeviceOp.create({
        data: {
          personId: op.personId,
          personName: op.personName,
          type: op.type,
          doorId: op.doorId,
          doorName: op.doorName,
          doorIp: op.doorIp,
          uid: op.uid,
          empCode: op.empCode,
          status: 'pending',
        },
      });
      this.logger.warn(`Queued ${op.type} for "${op.personName}" on ${op.doorName} (offline)`);
    }
  }

  async retryPendingOperations(): Promise<{ retried: number; succeeded: number; removed: number }> {
    const pending = await this.prisma.pendingDeviceOp.findMany({
      where: { status: { in: ['pending', 'in_progress'] } },
      orderBy: { createdAt: 'asc' },
    });

    if (pending.length === 0) return { retried: 0, succeeded: 0, removed: 0 };

    this.logger.log(`Retrying ${pending.length} pending device operations...`);
    let succeeded = 0;
    let removed = 0;

    for (const op of pending) {
      const door = await this.prisma.accessDoor.findUnique({ where: { id: op.doorId } });
      if (!door || door.state !== 1) {
        const newRetries = op.retries + 1;
        if (newRetries > 20) {
          await this.prisma.pendingDeviceOp.update({
            where: { id: op.id },
            data: { status: 'failed', retries: newRetries, lastError: 'جهاز غير متصل - تم تجاوز عدد المحاولات' },
          });
          removed++;
          this.logger.warn(`Dropping stale ${op.type} for "${op.personName}" on ${op.doorName} (too many retries)`);
        } else {
          await this.prisma.pendingDeviceOp.update({
            where: { id: op.id },
            data: { retries: newRetries },
          });
        }
        continue;
      }

      const person = await this.prisma.accessPerson.findUnique({ where: { id: op.personId } });

      try {
        let ok = false;
        if (op.type === 'block') {
          ok = await this.fallback.deleteUserFromDevice(op.doorIp, op.uid, op.personName, op.empCode || undefined);
        } else if (op.type === 'push' || op.type === 'update') {
          if (!person || !person.isActive) {
            await this.prisma.pendingDeviceOp.update({
              where: { id: op.id },
              data: { status: 'failed', lastError: 'الشخص غير موجود أو غير مفعّل' },
            });
            removed++;
            continue;
          }
          ok = await this.fallback.pushUserToDevice(op.doorIp, op.uid, op.empCode, person.name);
        }

        if (ok) {
          await this.prisma.pendingDeviceOp.update({
            where: { id: op.id },
            data: { status: 'success' },
          });
          succeeded++;
          this.logger.log(`Retry ${op.type} succeeded for "${op.personName}" on ${op.doorName}`);
        } else {
          const newRetries = op.retries + 1;
          if (newRetries > 20) {
            await this.prisma.pendingDeviceOp.update({
              where: { id: op.id },
              data: { status: 'failed', retries: newRetries, lastError: 'فشلت العملية' },
            });
            removed++;
          } else {
            await this.prisma.pendingDeviceOp.update({
              where: { id: op.id },
              data: { retries: newRetries, lastError: 'فشلت العملية' },
            });
          }
        }
      } catch (err) {
        const newRetries = op.retries + 1;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (newRetries > 20) {
          await this.prisma.pendingDeviceOp.update({
            where: { id: op.id },
            data: { status: 'failed', retries: newRetries, lastError: errMsg },
          });
          removed++;
        } else {
          await this.prisma.pendingDeviceOp.update({
            where: { id: op.id },
            data: { retries: newRetries, lastError: errMsg },
          });
        }
      }
    }

    const remaining = await this.prisma.pendingDeviceOp.count({
      where: { status: { in: ['pending', 'in_progress'] } },
    });

    return { retried: pending.length, succeeded, removed };
  }

  async getPendingOps() {
    return this.prisma.pendingDeviceOp.findMany({
      where: { status: { in: ['pending', 'in_progress', 'failed'] } },
      orderBy: { createdAt: 'desc' },
      include: { door: { select: { name: true, state: true } } },
    });
  }

  async getPendingOpsCount() {
    return this.prisma.pendingDeviceOp.count({
      where: { status: { in: ['pending', 'in_progress'] } },
    });
  }

  async remove(id: string) {
    const person = await this.prisma.accessPerson.findUnique({ where: { id } });
    if (!person) throw new NotFoundException('Person not found');

    // Remove from all physical devices (block + delete fingerprints)
    try {
      await this.removeFromAllDevices(person);
    } catch (err) {
      this.logger.warn(`Failed to remove person "${person.name}" from some devices: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
    }

    // Soft-delete in database
    return this.prisma.accessPerson.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
  }

  async pushPersonToDevice(personId: string, doorId: string): Promise<{ pushed: boolean; biometric: { fingers: number; face: boolean }; details: string[] }> {
    const details: string[] = [];
    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new NotFoundException('Person not found');

    const door = await this.prisma.accessDoor.findUnique({ where: { id: doorId } });
    if (!door) throw new NotFoundException('Door not found');
    if (!door.ipAddress) throw new NotFoundException('Door has no IP address');

    const uid = person.personId || 0;
    const empCode = person.empCode || String(uid);

    let pushed = false;
    try {
      pushed = await this.fallback.pushUserToDevice(door.ipAddress, uid, empCode, person.name);
      if (pushed) {
        details.push(`تم إرسال "${person.name}" إلى ${door.name}`);
      } else {
        details.push(`فشل الإرسال إلى ${door.name}`);
      }
    } catch (err) {
      details.push(`خطأ: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Also restore biometric templates (best-effort)
    let bioResult = { fingers: 0, face: false };
    if (pushed) {
      try {
        bioResult = await this.biometric.restoreTemplates(personId, door.ipAddress);
        if (bioResult.fingers > 0) {
          details.push(`تم استعادة ${bioResult.fingers} بصمة`);
        }
      } catch (err) {
        this.logger.warn(`Failed to restore templates on push: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { pushed, biometric: bioResult, details };
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
        where: { empCode: { not: null }, isActive: true, deletedAt: null },
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
          deletedAt: null,
          OR: [
            { personId: deviceUser.uid },
            { name: deviceUser.name },
          ],
        },
      });

      let personId: string;

      if (!existingPerson) {
        const newPerson = await this.prisma.accessPerson.create({
          data: {
            personType: 'EMPLOYEE',
            name: deviceUser.name || `User ${deviceUser.uid}`,
            personId: deviceUser.uid,
            empCode: deviceUser.userId || String(deviceUser.uid),
            fingerprintStatus: 'enrolled',
            isActive: true,
            lastSyncAt: new Date(),
          },
        });
        personId = newPerson.id;
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
        personId = existingPerson.id;
        details.push(`محدّث: ${deviceUser.name || existingPerson.name} (UID: ${deviceUser.uid})${nameChanged ? ' — تم تغيير الاسم' : ''}`);
        updated++;
      }

      // Create permission for source door if not exists
      const existingPerm = await this.prisma.accessPermission.findFirst({
        where: { personId, doorId: door.id },
      });
      if (!existingPerm) {
        await this.prisma.accessPermission.create({
          data: { personId, doorId: door.id },
        });
      }
    }

    // Pull biometric templates for all synced users (best-effort, in background)
    for (const deviceUser of deviceUsers) {
      const person = await this.prisma.accessPerson.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { personId: deviceUser.uid },
            { name: deviceUser.name },
          ],
        },
      });
      if (person) {
        try {
          await this.biometric.pullAndStoreTemplates(person.id, door.ipAddress!);
        } catch (err) {
          this.logger.warn(`Failed to pull templates for "${person.name}" from ${door.name}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // Push newly created active persons to their other permitted doors
    const allDoors = await this.prisma.accessDoor.findMany({ where: { state: 1 } });
    const otherDoors = allDoors.filter(d => d.id !== door.id && d.ipAddress);

    if (otherDoors.length > 0) {
      for (const deviceUser of deviceUsers) {
        const person = await this.prisma.accessPerson.findFirst({
          where: {
            deletedAt: null,
            OR: [
              { personId: deviceUser.uid },
              { name: deviceUser.name },
            ],
          },
          include: { permissions: { include: { door: true } } },
        });
        if (!person || !person.isActive) continue;

        const uid = person.personId || 0;
        const empCode = person.empCode || String(uid);

        const permittedOtherDoors = person.permissions
          .map(p => p.door)
          .filter(d => d?.ipAddress && d.id !== door.id && d.state === 1);

        for (const targetDoor of permittedOtherDoors) {
          try {
            const pushed = await this.fallback.pushUserToDevice(targetDoor.ipAddress!, uid, empCode, person.name);
            if (pushed) {
              this.logger.log(`Sync: pushed "${person.name}" to ${targetDoor.name} (${targetDoor.ipAddress})`);
            }
          } catch {
            // Best-effort
          }
        }
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
