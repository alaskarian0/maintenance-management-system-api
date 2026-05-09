import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AccessFallbackService, DeviceUserInfo } from './access-fallback.service';
import { AccessBiometricService } from './access-biometric.service';

@Injectable()
export class AccessDeviceSyncService {
  private readonly logger = new Logger(AccessDeviceSyncService.name);

  constructor(
    private prisma: PrismaService,
    private fallback: AccessFallbackService,
    private biometric: AccessBiometricService,
  ) {}

  async getPermittedDevices(personId: string): Promise<{ id: string; name: string; ipAddress: string | null; state: number; doorId: string; doorName: string }[]> {
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

  async getAllOnlineDevices(): Promise<{ id: string; name: string; ipAddress: string | null; state: number; doorId: string }[]> {
    const devices = await this.prisma.accessDevice.findMany({
      where: { state: 1, ipAddress: { not: null } },
    });
    return devices;
  }

  async removeFromAllDevices(person: { id: string; personId: number | null; empCode: string | null; name: string }): Promise<{ success: number; failed: number; details: string[] }> {
    const permittedDevices = await this.getPermittedDevices(person.id);
    const uid = person.personId || 0;
    let success = 0;
    let failed = 0;
    const details: string[] = [];

    const onlineDevices = permittedDevices.filter(d => d.ipAddress && d.state === 1);
    const offlineDevices = permittedDevices.filter(d => d.ipAddress && d.state !== 1);

    for (const device of onlineDevices) {
      try {
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

    for (const device of offlineDevices) {
      details.push(`${device.name} غير متصل — سيتم عند الاتصال`);
      await this.enqueueOp({ personId: person.id, personName: person.name, type: 'block', doorId: device.doorId, doorName: device.doorName || device.name, doorIp: device.ipAddress!, uid, empCode: '' });
    }

    return { success, failed, details };
  }

  async pushToPermittedDevices(person: { id: string; personId: number | null; empCode: string | null; name: string }): Promise<{ success: number; failed: number; details: string[] }> {
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

  async updateOnAllDevices(person: { id: string; personId: number | null; empCode: string | null; name: string; isActive: boolean }): Promise<{ success: number; failed: number; details: string[] }> {
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
}
