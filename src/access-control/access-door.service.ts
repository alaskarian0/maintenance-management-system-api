import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ZKBioClient, ZKBioPaginated, ZKBioTerminal } from './zkbio.client';

@Injectable()
export class AccessDoorService {
  constructor(
    private prisma: PrismaService,
    private zkBio: ZKBioClient,
  ) {}

  async findAll() {
    return this.prisma.accessDoor.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { permissions: true, logs: true } },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.accessDoor.findUnique({
      where: { id },
      include: {
        permissions: { include: { person: true } },
      },
    });
  }

  async create(data: {
    name: string;
    location?: string;
    serialNumber?: string;
    ipAddress?: string;
    zkTerminalId?: number;
  }) {
    return this.prisma.accessDoor.create({ data });
  }

  async update(
    id: string,
    data: { name?: string; location?: string; isAttendance?: boolean },
  ) {
    return this.prisma.accessDoor.update({ where: { id }, data });
  }

  async remove(id: string) {
    return this.prisma.accessDoor.delete({ where: { id } });
  }

  async syncFromZKBio() {
    const response = await this.zkBio.get<ZKBioPaginated<ZKBioTerminal>>(
      '/iclock/api/terminals/',
      { page_size: '100' },
    );

    const results = { synced: 0, created: 0, updated: 0 };

    for (const terminal of response.data) {
      const existing = await this.prisma.accessDoor.findFirst({
        where: {
          OR: [
            { zkTerminalId: terminal.id },
            { serialNumber: terminal.sn },
          ],
        },
      });

      const doorData = {
        zkTerminalId: terminal.id,
        name: terminal.alias || terminal.terminal_name || `Door ${terminal.sn}`,
        serialNumber: terminal.sn,
        ipAddress: terminal.ip_address,
        state: parseInt(terminal.state, 10) || 3,
        lastActivity: terminal.last_activity
          ? new Date(terminal.last_activity)
          : null,
        isAttendance: terminal.is_attendance === 1,
      };

      if (existing) {
        await this.prisma.accessDoor.update({
          where: { id: existing.id },
          data: doorData,
        });
        results.updated++;
      } else {
        await this.prisma.accessDoor.create({ data: doorData });
        results.created++;
      }
      results.synced++;
    }

    return results;
  }

  async getDoorPersons(doorId: string) {
    return this.prisma.accessPermission.findMany({
      where: { doorId },
      include: { person: true },
    });
  }
}
