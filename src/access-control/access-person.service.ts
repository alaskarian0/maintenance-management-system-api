import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AccessDeviceSyncService } from './access-device-sync.service';
import { AccessFallbackService } from './access-fallback.service';
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
    private sync: AccessDeviceSyncService,
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
          permissions: {
            select: {
              doorId: true,
              door: { select: { id: true, name: true } },
            },
          },
          department: { select: { id: true, name: true } },
          unit: { select: { id: true, name: true } },
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
    birthDate?: string;
    courtNumber?: string;
    departmentId?: string;
    unitId?: string;
    address?: string;
    hireDate?: string;
    role?: 'user' | 'admin';
    photoUrl?: string;
  }) {
    const createData: any = { ...data };
    if (data.accessEndDate) {
      createData.accessEndDate = new Date(data.accessEndDate);
    }
    if (data.birthDate) {
      createData.birthDate = new Date(data.birthDate);
    }
    if (data.hireDate) {
      createData.hireDate = new Date(data.hireDate);
    }
    return this.prisma.accessPerson.create({ data: createData });
  }

  async update(
    id: string,
    data: {
      name?: string; empCode?: string; region?: string; note?: string; phone?: string;
      isActive?: boolean; accessType?: 'permanent' | 'temporary'; accessEndDate?: string;
      birthDate?: string; courtNumber?: string; departmentId?: string; unitId?: string;
      address?: string; hireDate?: string; role?: 'user' | 'admin'; photoUrl?: string;
    },
  ) {
    const person = await this.prisma.accessPerson.findUnique({ where: { id } });
    if (!person) throw new NotFoundException('Person not found');

    const updateData: any = { ...data };
    if (data.accessEndDate !== undefined) {
      updateData.accessEndDate = data.accessEndDate ? new Date(data.accessEndDate) : null;
    }
    if (data.birthDate !== undefined) {
      updateData.birthDate = data.birthDate ? new Date(data.birthDate) : null;
    }
    if (data.hireDate !== undefined) {
      updateData.hireDate = data.hireDate ? new Date(data.hireDate) : null;
    }
    if (data.departmentId !== undefined) {
      updateData.departmentId = data.departmentId || null;
    }
    if (data.unitId !== undefined) {
      updateData.unitId = data.unitId || null;
    }

    const wasActive = person.isActive;
    const willBeActive = data.isActive ?? wasActive;

    const updated = await this.prisma.accessPerson.update({ where: { id }, data: updateData });

    const activeStatusChanged = wasActive !== willBeActive;
    const dataChanged = willBeActive && (data.name || data.empCode);

    // Run device sync in the background — don't block the response
    if (activeStatusChanged || dataChanged) {
      const syncTarget = { ...updated };
      setImmediate(async () => {
        try {
          let result: { success: number; failed: number; details: string[] };
          if (wasActive && !willBeActive) {
            result = await this.sync.removeFromAllDevices(syncTarget);
          } else if (!wasActive && willBeActive) {
            result = await this.sync.pushToPermittedDevices(syncTarget);
          } else {
            result = await this.sync.updateOnAllDevices(syncTarget);
          }
          this.logger.log(`Background device sync for "${syncTarget.name}": ${result.success} success, ${result.failed} failed`);
        } catch (err) {
          this.logger.warn(`Background device sync failed for "${syncTarget.name}": ${err instanceof Error ? err.message : err}`);
        }
      });
    }

    return { ...updated, _deviceSync: { success: 0, failed: 0, details: ['جارٍ المزامنة في الخلفية...'] } };
  }

  async remove(id: string) {
    const person = await this.prisma.accessPerson.findUnique({ where: { id } });
    if (!person) throw new NotFoundException('Person not found');

    try {
      await this.sync.removeFromAllDevices(person);
    } catch (err) {
      this.logger.warn(`Failed to remove person "${person.name}" from some devices: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
    }

    return this.prisma.accessPerson.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
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

    const device = door.devices.find(d => d.ipAddress);
    if (!device) {
      throw new NotFoundException(`Door "${door.name}" has no devices with IP address configured`);
    }

    const deviceUsers = await this.fallback.getDeviceUsers(device.ipAddress!);
    if (deviceUsers.length === 0) {
      details.push(`لا يوجد مستخدمين على الجهاز ${device.ipAddress}`);
      return { synced: 0, created: 0, updated: 0, details };
    }

    details.push(`تم العثور على ${deviceUsers.length} مستخدم على جهاز ${device.name} (${device.ipAddress})`);

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

  // Delegates to AccessDeviceSyncService
  async retryPendingOperations() {
    return this.sync.retryPendingOperations();
  }

  async getPendingOps() {
    return this.sync.getPendingOps();
  }

  async getPendingOpsCount() {
    return this.sync.getPendingOpsCount();
  }

  async expireTemporaryAccess() {
    return this.sync.expireTemporaryAccess();
  }

  searchEmployees(query: string): EmployeeEntry[] {
    return this.personSearch.searchEmployees(query);
  }

  async searchResidents(query: string): Promise<ResidentEntry[]> {
    return this.personSearch.searchResidents(query);
  }
}
