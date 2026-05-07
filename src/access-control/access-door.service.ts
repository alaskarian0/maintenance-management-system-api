import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AccessFallbackService } from './access-fallback.service';

@Injectable()
export class AccessDoorService {
  constructor(
    private prisma: PrismaService,
    private fallback: AccessFallbackService,
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

  async getDoorPersons(doorId: string) {
    return this.prisma.accessPermission.findMany({
      where: { doorId },
      include: { person: true },
    });
  }

  async pingDoor(id: string): Promise<{ reachable: boolean; ip: string; responseMs: number | null; message: string }> {
    const door = await this.prisma.accessDoor.findUnique({ where: { id } });
    if (!door) {
      return { reachable: false, ip: '', responseMs: null, message: 'Door not found' };
    }

    const ip = door.ipAddress || door.name;
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      await fetch(`http://${ip}`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const responseMs = Date.now() - start;

      if (door.state !== 1) {
        await this.prisma.accessDoor.update({
          where: { id },
          data: { state: 1, lastActivity: new Date() },
        });
      }

      return { reachable: true, ip, responseMs, message: `Device reachable (${responseMs}ms)` };
    } catch {
      try {
        const ZKAttendanceClient = require('zk-attendance-sdk');
        const client = new ZKAttendanceClient(ip, 4370, 3000, 2000);
        await client.createSocket();
        await client.disconnect();
        const tcpMs = Date.now() - start;

        if (door.state !== 1) {
          await this.prisma.accessDoor.update({
            where: { id },
            data: { state: 1, lastActivity: new Date() },
          });
        }

        return { reachable: true, ip, responseMs: tcpMs, message: `Device reachable via ZK port (${tcpMs}ms)` };
      } catch {
        if (door.state !== 3) {
          await this.prisma.accessDoor.update({
            where: { id },
            data: { state: 3 },
          });
        }

        return { reachable: false, ip, responseMs: null, message: `Device not reachable (${ip})` };
      }
    }
  }

  async pingAllDoors(): Promise<{ id: string; name: string; reachable: boolean; ip: string; responseMs: number | null }[]> {
    const doors = await this.prisma.accessDoor.findMany();
    const results = [];

    for (const door of doors) {
      const result = await this.pingDoor(door.id);
      results.push({
        id: door.id,
        name: door.name,
        reachable: result.reachable,
        ip: result.ip,
        responseMs: result.responseMs,
      });
    }

    return results;
  }

  async discoverDeviceInfo(id: string): Promise<{ serialNumber: string | null; firmware: string | null; deviceName: string | null } | null> {
    const door = await this.prisma.accessDoor.findUnique({ where: { id } });
    if (!door?.ipAddress) return null;

    const info = await this.fallback.getDeviceInfo(door.ipAddress);

    if (info?.serialNumber && !door.serialNumber) {
      await this.prisma.accessDoor.update({
        where: { id },
        data: { serialNumber: info.serialNumber },
      });
    }

    return info;
  }
}
