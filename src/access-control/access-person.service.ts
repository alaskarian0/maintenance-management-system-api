import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AccessDeviceSyncService } from './access-device-sync.service';
import { AccessFallbackService } from './access-fallback.service';
import { AccessBiometricService } from './access-biometric.service';
import { QueryPersonDto } from './dto/query-person.dto';
import { BatchResolveDto, ResolveItemDto } from './dto/resolve-device-users.dto';
import {
  PersonSearchService,
  EmployeeEntry,
  ResidentEntry,
  HrEmployee,
} from '../common/person-search.service';

export { EmployeeEntry, ResidentEntry, HrEmployee };

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
      doorId,
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
        { identifier: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (doorId) {
      where.permissions = { some: { doorId } };
    } else if (query.doorIds) {
      const ids = query.doorIds.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length === 1) {
        where.permissions = { some: { doorId: ids[0] } };
      } else if (ids.length > 1) {
        where.permissions = { some: { doorId: { in: ids } } };
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.accessPerson.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { permissions: true, fingerprintTemplates: true, faceTemplates: true } },
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
        fingerprintTemplates: { select: { id: true, fingerIndex: true, valid: true, source: true } },
        faceTemplates: { select: { id: true, faceIndex: true, valid: true, source: true } },
      },
    });
  }

  async create(data: {
    personType: 'EMPLOYEE' | 'RESIDENT' | 'OTHER';
    name: string;
    personId?: number;
    empCode?: string;
    identifier?: string;
    region?: string;
    note?: string;
    phone?: string;
    accessType?: 'permanent' | 'temporary';
    accessEndDate?: string;
    birthDate?: string;
    courtNumber?: string;
    departmentId?: string;
    unitId?: string;
    hireDate?: string;
    role?: 'user' | 'admin';
    photoUrl?: string;
    dataWarning?: string;
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

    // Auto-generate empCode if not provided
    if (!createData.empCode) {
      const typeLetter = data.personType === 'EMPLOYEE' ? 'm'
        : data.personType === 'RESIDENT' ? 's' : 'o';
      const count = await this.prisma.accessPerson.count();
      const nextNum = count + 1;
      createData.empCode = `${typeLetter}${nextNum}`;
    }

    return this.prisma.accessPerson.create({ data: createData });
  }

  async update(
    id: string,
    data: {
      name?: string; empCode?: string; identifier?: string; region?: string; note?: string; phone?: string;
      isActive?: boolean; accessType?: 'permanent' | 'temporary'; accessEndDate?: string;
      birthDate?: string; courtNumber?: string; departmentId?: string; unitId?: string;
      hireDate?: string; role?: 'user' | 'admin'; photoUrl?: string; dataWarning?: string;
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
    if (data.dataWarning !== undefined) {
      updateData.dataWarning = data.dataWarning || null;
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

  searchHrEmployees(query: string): HrEmployee[] {
    return this.personSearch.searchHrEmployees(query);
  }

  getHrEmployeeById(id: number): HrEmployee | undefined {
    return this.personSearch.getHrEmployeeById(id);
  }

  // ── Device User Resolution ──────────────────────────────────────

  async resolveDeviceUsers(doorId: string) {
    const door = await this.prisma.accessDoor.findUnique({
      where: { id: doorId },
      include: { devices: true },
    });
    if (!door) throw new NotFoundException(`Door ${doorId} not found`);

    const device = door.devices.find((d) => d.ipAddress);
    if (!device) {
      throw new NotFoundException(`Door "${door.name}" has no devices with IP address configured`);
    }

    const deviceUsers = await this.fallback.getDeviceUsers(device.ipAddress!);
    if (deviceUsers.length === 0) {
      return { totalOnDevice: 0, results: [] };
    }

    // Pre-load all active AccessPerson and FingerprintRecord for efficient matching
    const allPersons = await this.prisma.accessPerson.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        personType: true,
        name: true,
        personId: true,
        empCode: true,
        region: true,
        note: true,
        fingerprintStatus: true,
        isActive: true,
      },
    });

    const allFpRecords = await this.prisma.fingerprintRecord.findMany({
      select: {
        id: true,
        personType: true,
        name: true,
        personId: true,
        region: true,
        note: true,
      },
    });

    const results: {
      uid: number;
      userId: string;
      name: string;
      status: 'matched' | 'conflict' | 'new';
      personMatches: typeof allPersons;
      fingerprintMatches: typeof allFpRecords;
      bestMatch?: {
        person: (typeof allPersons)[number] | null;
        fingerprint: (typeof allFpRecords)[number] | null;
      };
    }[] = [];

    for (const deviceUser of deviceUsers) {
      const uidNum = deviceUser.uid;
      const userIdStr = deviceUser.userId || '';
      const nameLower = (deviceUser.name || '').toLowerCase().trim();

      // Search AccessPerson by personId (uid), empCode (userId), or name
      const personMatches = allPersons.filter((p) => {
        if (p.personId != null && p.personId === uidNum) return true;
        if (p.empCode && userIdStr && p.empCode.toLowerCase() === userIdStr.toLowerCase()) return true;
        if (nameLower && p.name.toLowerCase().trim() === nameLower) return true;
        // Fuzzy: name contains or is contained
        if (nameLower && p.name.toLowerCase().includes(nameLower)) return true;
        if (nameLower && nameLower.includes(p.name.toLowerCase())) return true;
        return false;
      });

      // Search FingerprintRecord by personId or name
      const fpMatches = allFpRecords.filter((fp) => {
        if (fp.personId != null && fp.personId === uidNum) return true;
        if (nameLower && fp.name.toLowerCase().trim() === nameLower) return true;
        if (nameLower && fp.name.toLowerCase().includes(nameLower)) return true;
        return false;
      });

      // Determine status
      const exactPersonMatch = personMatches.find(
        (p) => p.personId === uidNum || (p.empCode && p.empCode.toLowerCase() === userIdStr.toLowerCase()),
      );
      const exactFpMatch = fpMatches.find((fp) => fp.personId === uidNum);

      let status: 'matched' | 'conflict' | 'new';
      let bestMatch: { person: (typeof allPersons)[number] | null; fingerprint: (typeof allFpRecords)[number] | null } | undefined;

      if (exactPersonMatch && personMatches.length <= 1) {
        status = 'matched';
        bestMatch = { person: exactPersonMatch, fingerprint: exactFpMatch || null };
      } else if (personMatches.length === 1 && fpMatches.length <= 1) {
        status = 'matched';
        bestMatch = { person: personMatches[0], fingerprint: fpMatches[0] || null };
      } else if (personMatches.length > 1 || fpMatches.length > 1) {
        status = 'conflict';
        bestMatch = { person: exactPersonMatch || personMatches[0], fingerprint: exactFpMatch || null };
      } else {
        status = 'new';
        bestMatch = undefined;
      }

      results.push({
        uid: uidNum,
        userId: deviceUser.userId || '',
        name: deviceUser.name || `User ${uidNum}`,
        status,
        personMatches,
        fingerprintMatches: fpMatches,
        bestMatch,
      });
    }

    return {
      totalOnDevice: deviceUsers.length,
      deviceName: device.name,
      deviceIp: device.ipAddress,
      doorName: door.name,
      results,
    };
  }

  async batchResolve(dto: BatchResolveDto) {
    const details: string[] = [];
    let created = 0;
    let bound = 0;
    let merged = 0;
    let skipped = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.resolutions) {
        try {
          switch (item.action) {
            case 'skip':
              skipped++;
              details.push(`تم تخطي "${item.name}" (UID: ${item.uid})`);
              break;

            case 'create': {
              const uidNum = parseInt(item.uid, 10);
              const newPerson = await tx.accessPerson.create({
                data: {
                  personType: (item.resolvedFields?.personType as any) || 'EMPLOYEE',
                  name: item.resolvedFields?.name || item.name,
                  personId: isNaN(uidNum) ? null : uidNum,
                  empCode: item.userId || (isNaN(uidNum) ? undefined : String(uidNum)),
                  region: item.resolvedFields?.region || null,
                  note: item.resolvedFields?.note || null,
                  fingerprintStatus: 'enrolled',
                  isActive: true,
                  lastSyncAt: new Date(),
                },
              });

              if (dto.doorId) {
                const existingPerm = await tx.accessPermission.findFirst({
                  where: { personId: newPerson.id, doorId: dto.doorId },
                });
                if (!existingPerm) {
                  await tx.accessPermission.create({
                    data: { personId: newPerson.id, doorId: dto.doorId },
                  });
                }
              }

              created++;
              details.push(`تم إنشاء "${newPerson.name}" (UID: ${item.uid})`);
              break;
            }

            case 'bind': {
              if (!item.accessPersonId) {
                details.push(`تم تخطي "${item.name}" — لا يوجد شخص محدد للربط`);
                skipped++;
                break;
              }

              const person = await tx.accessPerson.findUnique({
                where: { id: item.accessPersonId },
              });
              if (!person) {
                details.push(`تم تخطي "${item.name}" — الشخص غير موجود`);
                skipped++;
                break;
              }

              const uidNum = parseInt(item.uid, 10);
              const updateData: any = {
                fingerprintStatus: 'enrolled',
                lastSyncAt: new Date(),
              };
              if (!isNaN(uidNum) && person.personId !== uidNum) {
                updateData.personId = uidNum;
              }
              if (item.resolvedFields?.name) updateData.name = item.resolvedFields.name;
              if (item.resolvedFields?.region !== undefined) updateData.region = item.resolvedFields.region;
              if (item.resolvedFields?.note !== undefined) updateData.note = item.resolvedFields.note;

              await tx.accessPerson.update({
                where: { id: person.id },
                data: updateData,
              });

              if (dto.doorId) {
                const existingPerm = await tx.accessPermission.findFirst({
                  where: { personId: person.id, doorId: dto.doorId },
                });
                if (!existingPerm) {
                  await tx.accessPermission.create({
                    data: { personId: person.id, doorId: dto.doorId },
                  });
                }
              }

              // If a fingerprint record is specified, update it to link to this person
              if (item.fingerprintRecordId) {
                await tx.fingerprintRecord.update({
                  where: { id: item.fingerprintRecordId },
                  data: {
                    personType: person.personType,
                    personId: person.personId,
                    name: person.name,
                  },
                });
              }

              bound++;
              details.push(`تم ربط "${item.name}" بـ "${person.name}"`);
              break;
            }

            case 'merge': {
              if (!item.accessPersonId || !item.secondaryPersonId) {
                details.push(`تم تخطي "${item.name}" — بيانات الدمج غير كافية`);
                skipped++;
                break;
              }

              const primary = await tx.accessPerson.findUnique({
                where: { id: item.accessPersonId },
              });
              const secondary = await tx.accessPerson.findUnique({
                where: { id: item.secondaryPersonId },
              });

              if (!primary || !secondary) {
                details.push(`تم تخطي "${item.name}" — أحد الشخصين غير موجود`);
                skipped++;
                break;
              }

              // Transfer permissions from secondary to primary (skip duplicates)
              const secondaryPerms = await tx.accessPermission.findMany({
                where: { personId: secondary.id },
              });
              for (const perm of secondaryPerms) {
                const existing = await tx.accessPermission.findFirst({
                  where: { personId: primary.id, doorId: perm.doorId },
                });
                if (!existing) {
                  await tx.accessPermission.update({
                    where: { id: perm.id },
                    data: { personId: primary.id },
                  });
                } else {
                  await tx.accessPermission.delete({ where: { id: perm.id } });
                }
              }

              // Update primary with resolved fields
              const mergeUpdate: any = {
                fingerprintStatus: 'enrolled',
                lastSyncAt: new Date(),
              };
              const uidNum = parseInt(item.uid, 10);
              if (!isNaN(uidNum)) mergeUpdate.personId = uidNum;
              if (item.resolvedFields?.name) mergeUpdate.name = item.resolvedFields.name;
              if (item.resolvedFields?.region !== undefined) mergeUpdate.region = item.resolvedFields.region;
              if (item.resolvedFields?.note !== undefined) mergeUpdate.note = item.resolvedFields.note;

              await tx.accessPerson.update({
                where: { id: primary.id },
                data: mergeUpdate,
              });

              // Soft-delete secondary
              await tx.accessPerson.update({
                where: { id: secondary.id },
                data: { isActive: false, deletedAt: new Date() },
              });

              merged++;
              details.push(`تم دمج "${secondary.name}" في "${primary.name}"`);
              break;
            }

            default:
              skipped++;
              details.push(`إجراء غير معروف لـ "${item.name}"`);
          }
        } catch (err) {
          details.push(`خطأ مع "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
          skipped++;
        }
      }
    });

    return { created, bound, merged, skipped, details };
  }
}
