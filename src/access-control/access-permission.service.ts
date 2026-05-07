import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ZKBioClient, ZKBioPaginated } from './zkbio.client';

interface ZKBioEmployee {
  id: number;
  emp_code: string;
  emp_name: string;
  area: { id: number; area_name: string }[];
}

@Injectable()
export class AccessPermissionService {
  private readonly logger = new Logger(AccessPermissionService.name);

  constructor(
    private prisma: PrismaService,
    private zkBio: ZKBioClient,
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

    const sync = await this.pushUserToZKBioTime(personId, doorId);

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

    const sync = await this.pushUserToZKBioTime(personId);

    return {
      permissions: results,
      _sync: sync,
    };
  }

  async revoke(id: string) {
    const perm = await this.prisma.accessPermission.findUnique({
      where: { id },
      include: { person: true, door: true },
    });

    const result = await this.prisma.accessPermission.delete({ where: { id } });

    let sync: SyncResult = { synced: false, message: 'No person found' };
    if (perm) {
      sync = await this.removeUserFromZKBioTime(perm.person, perm.door);
    }

    return {
      ...result,
      _sync: sync,
    };
  }

  async revokeByPersonDoor(personId: string, doorId: string) {
    const perm = await this.prisma.accessPermission.findUnique({
      where: { personId_doorId: { personId, doorId } },
      include: { person: true, door: true },
    });

    const result = await this.prisma.accessPermission.delete({
      where: { personId_doorId: { personId, doorId } },
    });

    let sync: SyncResult = { synced: false, message: 'No person found' };
    if (perm) {
      sync = await this.removeUserFromZKBioTime(perm.person, perm.door);
    }

    return {
      ...result,
      _sync: sync,
    };
  }

  private async pushUserToZKBioTime(personId: string, doorId?: string): Promise<SyncResult> {
    try {
      const person = await this.prisma.accessPerson.findUnique({
        where: { id: personId },
      });
      if (!person || !person.isActive) {
        return { synced: false, message: 'Person not found or inactive' };
      }

      const empCode = person.empCode || `P${person.personId || Date.now()}`;

      const existing = await this.zkBio.get<ZKBioPaginated<ZKBioEmployee>>(
        '/personnel/api/employees/',
        { emp_code: empCode },
      );

      if (existing.data && existing.data.length > 0) {
        this.logger.log(`Employee "${person.name}" (${empCode}) already exists in ZKBio Time`);
        return { synced: true, message: 'Employee already synced to ZKBio Time server' };
      }

      const newEmployee = await this.zkBio.post<ZKBioEmployee>(
        '/personnel/api/employees/',
        {
          emp_code: empCode,
          emp_name: person.name,
          department: 1,
          area: [1],
        },
      );

      this.logger.log(
        `Created employee "${person.name}" (${empCode}) in ZKBio Time (ID: ${newEmployee.id})`,
      );

      if (!person.empCode) {
        await this.prisma.accessPerson.update({
          where: { id: personId },
          data: { empCode: empCode },
        });
      }

      return { synced: true, message: `Employee "${person.name}" pushed to ZKBio Time server successfully` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to push user to ZKBio Time: ${msg}`);
      return { synced: false, message: `ZKBio Time server error: ${msg}` };
    }
  }

  private async removeUserFromZKBioTime(
    person: { id: string; name: string; empCode: string | null; personId: number | null } | null,
    door: { id: string; name: string; zkTerminalId: number | null } | null,
  ): Promise<SyncResult> {
    if (!person) {
      return { synced: false, message: 'No person provided' };
    }

    try {
      const empCode = person.empCode || `P${person.personId}`;

      const existing = await this.zkBio.get<ZKBioPaginated<ZKBioEmployee>>(
        '/personnel/api/employees/',
        { emp_code: empCode },
      );

      if (!existing.data || existing.data.length === 0) {
        this.logger.log(`Employee "${person.name}" not found in ZKBio Time, nothing to remove`);
        return { synced: true, message: 'Employee was not in ZKBio Time server' };
      }

      const zkEmpId = existing.data[0].id;

      await this.zkBio.del(`/personnel/api/employees/${zkEmpId}/`);

      this.logger.log(
        `Removed employee "${person.name}" (${empCode}) from ZKBio Time`,
      );

      return { synced: true, message: `Employee "${person.name}" removed from ZKBio Time server` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to remove user from ZKBio Time: ${msg}`);
      return { synced: false, message: `ZKBio Time server error: ${msg}` };
    }
  }
}

export interface SyncResult {
  synced: boolean;
  message: string;
}
