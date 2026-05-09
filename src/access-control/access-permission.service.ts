import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AccessFallbackService } from './access-fallback.service';

export interface SyncResult {
  synced: boolean;
  message: string;
}

@Injectable()
export class AccessPermissionService {
  private readonly logger = new Logger(AccessPermissionService.name);

  constructor(
    private prisma: PrismaService,
    private fallback: AccessFallbackService,
  ) {}

  async findAll() {
    return this.prisma.accessPermission.findMany({
      include: { person: true, door: true },
      orderBy: { grantedAt: 'desc' },
    });
  }

  async grant(personId: string, doorId: string, grantedBy?: string) {
    const result = await this.prisma.accessPermission.upsert({
      where: { personId_doorId: { personId, doorId } },
      create: { personId, doorId, grantedBy },
      update: { grantedBy },
    });

    const sync = await this.syncGrant(personId, doorId);

    return {
      ...result,
      _sync: sync,
    };
  }

  async bulkGrant(personId: string, doorIds: string[], grantedBy?: string) {
    const results = [];
    for (const doorId of doorIds) {
      const perm = await this.prisma.accessPermission.upsert({
        where: { personId_doorId: { personId, doorId } },
        create: { personId, doorId, grantedBy },
        update: {},
      });
      results.push(perm);
    }

    const sync = await this.syncGrant(personId);

    return {
      permissions: results,
      _sync: sync,
    };
  }

  async revoke(id: string) {
    const perm = await this.prisma.accessPermission.findUnique({
      where: { id },
      include: { person: true, door: { include: { devices: true } } },
    });

    const result = await this.prisma.accessPermission.delete({ where: { id } });

    let sync: SyncResult = { synced: false, message: 'No person found' };
    if (perm) {
      sync = await this.syncRevoke(perm.person, perm.door);
    }

    return {
      ...result,
      _sync: sync,
    };
  }

  async revokeByPersonDoor(personId: string, doorId: string) {
    const perm = await this.prisma.accessPermission.findUnique({
      where: { personId_doorId: { personId, doorId } },
      include: { person: true, door: { include: { devices: true } } },
    });

    const result = await this.prisma.accessPermission.delete({
      where: { personId_doorId: { personId, doorId } },
    });

    let sync: SyncResult = { synced: false, message: 'No person found' };
    if (perm) {
      sync = await this.syncRevoke(perm.person, perm.door);
    }

    return {
      ...result,
      _sync: sync,
    };
  }

  private async syncGrant(personId: string, doorId?: string): Promise<SyncResult> {
    const person = await this.prisma.accessPerson.findUnique({
      where: { id: personId },
    });
    if (!person || !person.isActive) {
      return { synced: false, message: 'Person not found or inactive' };
    }

    const empCode = person.empCode || `P${person.personId || Date.now()}`;
    const uid = person.personId || Math.abs(person.id.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));

    let devices: { id: string; name: string; ipAddress: string | null; state: number }[] = [];

    if (doorId) {
      const door = await this.prisma.accessDoor.findUnique({
        where: { id: doorId },
        include: { devices: true },
      });
      devices = (door?.devices || []).map(d => ({ id: d.id, name: d.name, ipAddress: d.ipAddress, state: d.state }));
    } else {
      devices = await this.prisma.accessDevice.findMany({ where: { state: 1 } });
    }

    let successCount = 0;
    let failCount = 0;

    for (const device of devices) {
      if (!device.ipAddress) continue;

      const pushed = await this.fallback.pushUserToDevice(
        device.ipAddress,
        uid,
        empCode,
        person.name,
      );
      if (pushed) {
        successCount++;
      } else {
        failCount++;
      }
    }

    if (successCount > 0) {
      if (!person.empCode) {
        await this.prisma.accessPerson.update({
          where: { id: personId },
          data: { empCode },
        });
      }
      return { synced: true, message: `Employee "${person.name}" pushed to ${successCount} device(s)${failCount > 0 ? ` (${failCount} failed)` : ''}` };
    }

    return {
      synced: false,
      message: `Failed to push "${person.name}" to any device. ${failCount} device(s) unreachable.`,
    };
  }

  private async syncRevoke(
    person: { id: string; name: string; empCode: string | null; personId: number | null } | null,
    door: { id: string; devices?: { id: string; name: string; ipAddress: string | null; state: number }[] } | null,
  ): Promise<SyncResult> {
    if (!person) {
      return { synced: false, message: 'No person provided' };
    }

    const uid = person.personId || 0;

    // Get devices from the specific door
    if (door?.devices?.length) {
      for (const device of door.devices) {
        if (device.ipAddress) {
          const removed = await this.fallback.deleteUserFromDevice(device.ipAddress, uid);
          if (removed) {
            return { synced: true, message: `Employee removed from device "${device.name}" via ZK SDK` };
          }
        }
      }
    }

    // If no specific door or the specific door failed, try all devices the person has access to
    const permissions = await this.prisma.accessPermission.findMany({
      where: { personId: person.id },
      include: { door: { include: { devices: true } } },
    });

    let removed = false;
    for (const perm of permissions) {
      for (const device of perm.door.devices) {
        if (device.ipAddress) {
          const success = await this.fallback.deleteUserFromDevice(device.ipAddress, uid);
          if (success) removed = true;
        }
      }
    }

    if (removed) {
      return { synced: true, message: `Employee removed from device(s) via ZK SDK` };
    }

    return {
      synced: false,
      message: `Could not remove "${person.name}" from any device.`,
    };
  }
}
