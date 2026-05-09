import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AccessFallbackService, DeviceUserInfo } from './access-fallback.service';
import { AccessBiometricService } from './access-biometric.service';
import { QueryPersonDto } from './dto/query-person.dto';
import {
  PersonSearchService,
  EmployeeEntry,
  ResidentEntry,
} from '../common/person-search.service';

export { EmployeeEntry, ResidentEntry };

@Injectable()
export class AccessPersonService {
  private readonly logger = new Logger(AccessPersonService.name);

  constructor(
    private prisma: PrismaService,
    private fallback: AccessFallbackService,
    private biometric: AccessBiometricService,
    private personSearch: PersonSearchService,
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

    // Batch lookup FingerprintRecord for cross-reference
    const fingerprints = await this.prisma.fingerprintRecord.findMany({
      select: { personType: true, personId: true, id: true },
    });
    const fpMap = new Map<string, string>();
    for (const fp of fingerprints) {
      if (fp.personId != null) {
        fpMap.set(`${fp.personType}:${fp.personId}`, fp.id);
      }
    }

    const enrichedData = data.map((person) => ({
      ...person,
      fingerprintRecordId:
        person.personId != null
          ? fpMap.get(`${person.personType}:${person.personId}`) ?? null
          : null,
    }));

    return { data: enrichedData, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    return this.prisma.accessPerson.findUnique({
      where: { id },
      include: {
        permissions: { include: { door: { include: { devices: true } } } },
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
    accessType?: 'permanent' | 'temporary';
    accessEndDate?: string;
  }) {
    const createData: any = { ...data };
    if (data.accessEndDate) {
      createData.accessEndDate = new Date(data.accessEndDate);
    }
    return this.prisma.accessPerson.create({ data: createData });
  }

  async update(
    id: string,
    data: { name?: string; empCode?: string; region?: string; note?: string; phone?: string; isActive?: boolean; accessType?: 'permanent' | 'temporary'; accessEndDate?: string },
  ) {
    const person = await this.prisma.accessPerson.findUnique({ where: { id } });
    if (!person) throw new NotFoundException('Person not found');

    const updateData: any = { ...data };
    if (data.accessEndDate !== undefined) {
      updateData.accessEndDate = data.accessEndDate ? new Date(data.accessEndDate) : null;
    }

    const wasActive = person.isActive;
    const willBeActive = data.isActive ?? wasActive;

    const updated = await this.prisma.accessPerson.update({ where: { id }, data: updateData });

    const activeStatusChanged = wasActive !== willBeActive;
    const dataChanged = willBeActive && (data.name || data.empCode);

    // Run device sync in the background — don't block the response
    if (activeStatusChanged || dataChanged) {
      const syncTarget = { ...updated };
      // Fire-and-forget: update DB immediately, sync devices async
      setImmediate(async () => {
        try {
          let result: { success: number; failed: number; details: string[] };
          if (wasActive && !willBeActive) {
            result = await this.removeFromAllDevices(syncTarget);
          } else if (!wasActive && willBeActive) {
            result = await this.pushToPermittedDevices(syncTarget);
          } else {
            result = await this.updateOnAllDevices(syncTarget);
          }
          this.logger.log(`Background device sync for "${syncTarget.name}": ${result.success} success, ${result.failed} failed`);
        } catch (err) {
          this.logger.warn(`Background device sync failed for "${syncTarget.name}": ${err instanceof Error ? err.message : err}`);
        }
      });
    }

    return { ...updated, _deviceSync: { success: 0, failed: 0, details: ['جارٍ المزامنة في الخلفية...'] } };
  }

  private async getPermittedDevices(personId: string): Promise<{ id: string; name: string; ipAddress: string | null; state: number; doorId: string; doorName: string }[]> {
    const permissions = await this.prisma.accessPermission.findMany({
      where: { personId },
      include: { door: { include: { devices: true } } },
    });

    const devices: { id: string; name: string; ipAddress: string | null; state: number; doorId: string; doorName: string }[] = [];
    for (const perm of permissions) {
      for (const device of perm.door.devices) {
        devices.push({
          id: device.id,
          name: device.name,
          ipAddress: device.ipAddress,
          state: device.state,
          doorId: perm.door.id,
          doorName: perm.door.name,
        });
      }
    }
    return devices;
  }

  private async getAllOnlineDevices(): Promise<{ id: string; name: string; ipAddress: string | null; state: number; doorId: string }[]> {
    const devices = await this.prisma.accessDevice.findMany({
      where: { state: 1, ipAddress: { not: null } },
    });
    return devices;
  }

  private async removeFromAllDevices(person: { id: string; personId: number | null; empCode: string | null; name: string }): Promise<{ success: number; failed: number; details: string[] }> {
    const permittedDevices = await this.getPermittedDevices(person.id);
    const uid = person.personId || 0;
    let success = 0;
    let failed = 0;
    const details: string[] = [];

    const onlineDevices = permittedDevices.filter(d => d.ipAddress && d.state === 1);
    const offlineDevices = permittedDevices.filter(d => d.ipAddress && d.state !== 1);

    // Process online permitted devices
    for (const device of onlineDevices) {
      try {
        // Save biometric templates before blocking (best-effort)
        try {
          const pulled = await this.biometric.pullAndStoreTemplates(person.id, device.ipAddress!);
          if (pulled.fingers > 0) {
            this.logger.log(`Saved ${pulled.fingers} fingerprint templates from ${device.name} before blocking`);
          }
        } catch (err) {
          this.logger.warn(`Failed to pull templates from ${device.name}: ${err instanceof Error ? err.message : err}`);
        }

        const removed = await this.fallback.deleteUserFromDevice(device.ipAddress!, uid, person.name, person.empCode || undefined);
        if (removed) {
          success++;
          this.logger.log(`Blocked "${person.name}" on device ${device.name} (${device.ipAddress})`);
        } else {
          failed++;
          details.push(`فشل الحظر على ${device.name}`);
          await this.enqueueOp({ personId: person.id, personName: person.name, type: 'block', doorId: device.doorId, doorName: device.doorName || device.name, doorIp: device.ipAddress!, uid, empCode: '' });
        }
      } catch {
        failed++;
        details.push(`خطأ على ${device.name}`);
        await this.enqueueOp({ personId: person.id, personName: person.name, type: 'block', doorId: device.doorId, doorName: device.doorName || device.name, doorIp: device.ipAddress!, uid, empCode: '' });
      }
    }

    // Queue offline permitted devices for retry
    for (const device of offlineDevices) {
      details.push(`${device.name} غير متصل — سيتم عند الاتصال`);
      await this.enqueueOp({ personId: person.id, personName: person.name, type: 'block', doorId: device.doorId, doorName: device.doorName || device.name, doorIp: device.ipAddress!, uid, empCode: '' });
    }

    return { success, failed, details };
  }

  private async pushToPermittedDevices(person: { id: string; personId: number | null; empCode: string | null; name: string }): Promise<{ success: number; failed: number; details: string[] }> {
    const empCode = person.empCode || `P${person.personId || Date.now()}`;
    const uid = person.personId || Math.abs(person.id.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));

    const permittedDevices = await this.getPermittedDevices(person.id);
    if (permittedDevices.length === 0) {
      return { success: 0, failed: 0, details: ['لا توجد أبواب مصرح بها — حدد الأبواب أولاً'] };
    }

    let success = 0;
    let failed = 0;
    const details: string[] = [];

    for (const device of permittedDevices) {
      if (!device.ipAddress) continue;
      if (device.state !== 1) {
        details.push(`${device.name} غير متصل — سيتم عند الاتصال`);
        await this.enqueueOp({ personId: person.id, personName: person.name, type: 'push', doorId: device.doorId, doorName: device.doorName || device.name, doorIp: device.ipAddress!, uid, empCode });
        continue;
      }
      try {
        const pushed = await this.fallback.pushUserToDevice(device.ipAddress, uid, empCode, person.name);
        if (pushed) {
          success++;
          this.logger.log(`Pushed "${person.name}" to device ${device.name} (${device.ipAddress})`);

          // Restore biometric templates (best-effort)
          try {
            const restored = await this.biometric.restoreTemplates(person.id, device.ipAddress!);
            if (restored.fingers > 0) {
              this.logger.log(`Restored ${restored.fingers} fingerprints for "${person.name}" on ${device.name}`);
            }
          } catch (err) {
            this.logger.warn(`Failed to restore templates on ${device.name}: ${err instanceof Error ? err.message : err}`);
          }
        } else {
          failed++;
          details.push(`فشل الإرسال إلى ${device.name}`);
          await this.enqueueOp({ personId: person.id, personName: person.name, type: 'push', doorId: device.doorId, doorName: device.doorName || device.name, doorIp: device.ipAddress!, uid, empCode });
        }
      } catch {
        failed++;
        details.push(`خطأ على ${device.name}`);
        await this.enqueueOp({ personId: person.id, personName: person.name, type: 'push', doorId: device.doorId, doorName: device.doorName || device.name, doorIp: device.ipAddress!, uid, empCode });
      }
    }

    return { success, failed, details };
  }

  private async updateOnAllDevices(person: { id: string; personId: number | null; empCode: string | null; name: string; isActive: boolean }): Promise<{ success: number; failed: number; details: string[] }> {
    if (!person.isActive) return { success: 0, failed: 0, details: [] };

    const allDevices = await this.getAllOnlineDevices();
    const uid = person.personId || 0;
    const empCode = person.empCode || String(uid);
    let success = 0;
    let failed = 0;
    const details: string[] = [];

    for (const device of allDevices) {
      if (!device.ipAddress) continue;
      if (device.state !== 1) {
        details.push(`${device.name} غير متصل — سيتم عند الاتصال`);
        await this.enqueueOp({ personId: person.id, personName: person.name, type: 'update', doorId: device.doorId, doorName: device.name, doorIp: device.ipAddress!, uid, empCode });
        continue;
      }
      try {
        const pushed = await this.fallback.pushUserToDevice(device.ipAddress, uid, empCode, person.name);
        if (pushed) {
          success++;
          this.logger.log(`Updated "${person.name}" on device ${device.name} (${device.ipAddress})`);
        } else {
          failed++;
          details.push(`فشل التحديث على ${device.name}`);
          await this.enqueueOp({ personId: person.id, personName: person.name, type: 'update', doorId: device.doorId, doorName: device.name, doorIp: device.ipAddress!, uid, empCode });
        }
      } catch {
        failed++;
        details.push(`خطأ على ${device.name}`);
        await this.enqueueOp({ personId: person.id, personName: person.name, type: 'update', doorId: device.doorId, doorName: device.name, doorIp: device.ipAddress!, uid, empCode });
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
      // Find a device with this IP under the referenced door
      const device = await this.prisma.accessDevice.findFirst({
        where: { doorId: op.doorId, ipAddress: op.doorIp },
      });

      if (!device || device.state !== 1) {
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
      include: { door: { select: { name: true } } },
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

    const door = await this.prisma.accessDoor.findUnique({
      where: { id: doorId },
      include: { devices: true },
    });
    if (!door) throw new NotFoundException('Door not found');

    const uid = person.personId || 0;
    const empCode = person.empCode || String(uid);

    let pushed = false;
    // Push to all devices under this door
    for (const device of door.devices) {
      if (!device.ipAddress) continue;
      try {
        const ok = await this.fallback.pushUserToDevice(device.ipAddress, uid, empCode, person.name);
        if (ok) {
          pushed = true;
          details.push(`تم إرسال "${person.name}" إلى ${device.name}`);
        } else {
          details.push(`فشل الإرسال إلى ${device.name}`);
        }
      } catch (err) {
        details.push(`خطأ: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Also restore biometric templates (best-effort)
    let bioResult = { fingers: 0, face: false };
    if (pushed) {
      for (const device of door.devices) {
        if (!device.ipAddress) continue;
        try {
          const result = await this.biometric.restoreTemplates(personId, device.ipAddress);
          bioResult.fingers += result.fingers;
          bioResult.face = bioResult.face || result.face;
          if (result.fingers > 0) {
            details.push(`تم استعادة ${result.fingers} بصمة على ${device.name}`);
          }
        } catch (err) {
          this.logger.warn(`Failed to restore templates on push: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    return { pushed, biometric: bioResult, details };
  }

  async getPersonDoors(personId: string) {
    return this.prisma.accessPermission.findMany({
      where: { personId },
      include: { door: { include: { devices: true } } },
    });
  }

  async checkPersonOnDevices(personId: string): Promise<Record<string, { exists: boolean; name?: string }>> {
    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new NotFoundException('Person not found');

    const devices = await this.prisma.accessDevice.findMany({ where: { state: 1 } });
    const uid = person.personId || 0;
    const empCode = person.empCode || String(uid);

    const results: Record<string, { exists: boolean; name?: string }> = {};

    for (const device of devices) {
      if (!device.ipAddress) {
        results[device.id] = { exists: false };
        continue;
      }
      try {
        const check = await this.fallback.checkUserOnDevice(device.ipAddress, uid, empCode);
        results[device.id] = { exists: check.exists, name: check.name };
      } catch {
        results[device.id] = { exists: false };
      }
    }

    return results;
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

      const devices = await this.prisma.accessDevice.findMany({ where: { state: 1 } });

      for (const person of persons) {
        let found = false;

        for (const device of devices) {
          if (!device.ipAddress) continue;

          try {
            const users = await this.fallback.getDeviceUsers(device.ipAddress);
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
              details.push(`${person.name}: مسجّل على ${device.name} (UID: ${match.uid})`);
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

    const door = await this.prisma.accessDoor.findUnique({
      where: { id: doorId },
      include: { devices: true },
    });

    if (!door) {
      throw new NotFoundException(`Door ${doorId} not found`);
    }

    // Find a device with IP under this door
    const device = door.devices.find(d => d.ipAddress);
    if (!device) {
      throw new NotFoundException(`Door "${door.name}" has no devices with IP address configured`);
    }

    const deviceUsers: DeviceUserInfo[] = await this.fallback.getDeviceUsers(device.ipAddress!);
    if (deviceUsers.length === 0) {
      details.push(`لا يوجد مستخدمين على الجهاز ${device.ipAddress}`);
      return { synced: 0, created: 0, updated: 0, details };
    }

    details.push(`تم العثور على ${deviceUsers.length} مستخدم على جهاز ${device.name} (${device.ipAddress})`);

    // Get all other online devices across all doors
    const allOtherDevices = await this.prisma.accessDevice.findMany({
      where: { state: 1, ipAddress: { not: null }, id: { not: device.id } },
    });

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

      let person: { id: string; personId: number | null; empCode: string | null; name: string; isActive: boolean };

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
        person = newPerson;
        details.push(`جديد: ${deviceUser.name} (UID: ${deviceUser.uid})`);
        created++;
      } else {
        const nameChanged = deviceUser.name && deviceUser.name !== existingPerson.name;
        const updatedPerson = await this.prisma.accessPerson.update({
          where: { id: existingPerson.id },
          data: {
            ...(nameChanged ? { name: deviceUser.name } : {}),
            fingerprintStatus: 'enrolled',
            lastSyncAt: new Date(),
          },
        });
        person = updatedPerson;
        details.push(`محدّث: ${deviceUser.name || existingPerson.name} (UID: ${deviceUser.uid})${nameChanged ? ' — تم تغيير الاسم' : ''}`);
        updated++;
      }

      const existingPerm = await this.prisma.accessPermission.findFirst({
        where: { personId: person.id, doorId: door.id },
      });
      if (!existingPerm) {
        await this.prisma.accessPermission.create({
          data: { personId: person.id, doorId: door.id },
        });
      }

      try {
        await this.biometric.pullAndStoreTemplates(person.id, device.ipAddress!);
      } catch (err) {
        this.logger.warn(`Failed to pull templates for "${person.name}" from ${device.name}: ${err instanceof Error ? err.message : err}`);
      }

      if (allOtherDevices.length > 0 && person.isActive) {
        const permissions = await this.prisma.accessPermission.findMany({
          where: { personId: person.id },
          include: { door: { include: { devices: true } } },
        });
        const uid = person.personId || 0;
        const empCode = person.empCode || String(uid);

        // Get all device IPs from permitted doors (excluding current device)
        const permittedOtherDevices: { ipAddress: string; name: string }[] = [];
        for (const perm of permissions) {
          for (const d of perm.door.devices) {
            if (d.ipAddress && d.id !== device.id && d.state === 1) {
              permittedOtherDevices.push({ ipAddress: d.ipAddress!, name: d.name });
            }
          }
        }

        for (const targetDevice of permittedOtherDevices) {
          try {
            const pushed = await this.fallback.pushUserToDevice(targetDevice.ipAddress, uid, empCode, person.name);
            if (pushed) {
              this.logger.log(`Sync: pushed "${person.name}" to ${targetDevice.name} (${targetDevice.ipAddress})`);
            }
          } catch {
            // Best-effort
          }
        }
      }
    }

    return { synced: deviceUsers.length, created, updated, details };
  }

  async expireTemporaryAccess(): Promise<{ expired: number }> {
    const now = new Date();
    const expiredPersons = await this.prisma.accessPerson.findMany({
      where: {
        accessType: 'temporary',
        accessEndDate: { lte: now },
        isActive: true,
        deletedAt: null,
      },
    });

    if (expiredPersons.length === 0) return { expired: 0 };

    this.logger.log(`Expiring ${expiredPersons.length} temporary access persons`);

    for (const person of expiredPersons) {
      try {
        await this.prisma.accessPerson.update({
          where: { id: person.id },
          data: { isActive: false },
        });
        await this.removeFromAllDevices(person);
        this.logger.log(`Expired temporary access for "${person.name}" (ended ${person.accessEndDate?.toISOString() ?? 'unknown'})`);
      } catch (err) {
        this.logger.warn(`Failed to expire "${person.name}": ${err instanceof Error ? err.message : err}`);
      }
    }

    return { expired: expiredPersons.length };
  }

  searchEmployees(query: string): EmployeeEntry[] {
    return this.personSearch.searchEmployees(query);
  }

  async searchResidents(query: string): Promise<ResidentEntry[]> {
    return this.personSearch.searchResidents(query);
  }
}
