import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AccessFallbackService } from './access-fallback.service';

@Injectable()
export class AccessDoorService {
  constructor(
    private prisma: PrismaService,
    private fallback: AccessFallbackService,
  ) {}

  private async getDoorIp(id: string): Promise<string> {
    const door = await this.prisma.accessDoor.findUnique({ where: { id } });
    if (!door) throw new NotFoundException('Door not found');
    if (!door.ipAddress) throw new NotFoundException('Door has no IP address configured');
    return door.ipAddress;
  }

  private async getDoorRecord(id: string): Promise< { ipAddress: string; serialNumber: string | null; id: string; [key: string]: any } > {
    const door = await this.prisma.accessDoor.findUnique({ where: { id } });
    if (!door) throw new NotFoundException('Door not found');
    if (!door.ipAddress) throw new NotFoundException('Door has no IP address configured');
    return door as typeof door & { ipAddress: string };
  }

  private async execAction(id: string, fn: (ip: string) => Promise<boolean>, label: string) {
    const ip = await this.getDoorIp(id);
    const ok = await fn(ip);
    if (!ok) throw new Error(`Failed to ${label}`);
    return { success: true };
  }

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
    group?: 'INSIDE' | 'OUTSIDE';
    serialNumber?: string;
    ipAddress?: string;
    zkTerminalId?: number;
  }) {
    return this.prisma.accessDoor.create({ data });
  }

  async update(
    id: string,
    data: { name?: string; location?: string; group?: 'INSIDE' | 'OUTSIDE'; isAttendance?: boolean },
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

  // ── Device Control Methods ──────────────────────────────────────────

  async getFullDeviceInfo(id: string) {
    const door = await this.getDoorRecord(id);
    const info = await this.fallback.getFullDeviceInfo(door.ipAddress);
    if (!info) return null;
    if (info.serialNumber && !door.serialNumber) {
      await this.prisma.accessDoor.update({
        where: { id },
        data: { serialNumber: info.serialNumber },
      });
    }
    return info;
  }

  async getDeviceTime(id: string) {
    const ip = await this.getDoorIp(id);
    return this.fallback.getDeviceTime(ip);
  }

  async setDeviceTime(id: string) {
    return this.execAction(id, (ip) => this.fallback.setDeviceTime(ip), 'set device time');
  }

  async getDoorState(id: string) {
    const ip = await this.getDoorIp(id);
    const state = await this.fallback.getDoorState(ip);
    return state ?? { state: -1, label: 'unknown' };
  }

  async unlockDoor(id: string) {
    return this.execAction(id, (ip) => this.fallback.unlockDoor(ip), 'unlock door');
  }

  async restartDevice(id: string) {
    const result = await this.execAction(id, (ip) => this.fallback.restartDevice(ip), 'restart device');
    await this.prisma.accessDoor.update({ where: { id }, data: { state: 3 } }).catch(() => {});
    return result;
  }

  async freezeDevice(id: string) {
    return this.execAction(id, (ip) => this.fallback.freezeDevice(ip), 'freeze device');
  }

  async unfreezeDevice(id: string) {
    return this.execAction(id, (ip) => this.fallback.unfreezeDevice(ip), 'unfreeze device');
  }

  async testVoice(id: string) {
    return this.execAction(id, (ip) => this.fallback.testVoice(ip), 'test voice');
  }

  async cancelAlarm(id: string) {
    return this.execAction(id, (ip) => this.fallback.cancelAlarm(ip), 'cancel alarm');
  }

  async powerOffDevice(id: string) {
    const result = await this.execAction(id, (ip) => this.fallback.powerOffDevice(ip), 'power off device');
    await this.prisma.accessDoor.update({ where: { id }, data: { state: 3 } }).catch(() => {});
    return result;
  }

  async getDeviceOptions(id: string) {
    const ip = await this.getDoorIp(id);
    const options = await this.fallback.getDeviceOptions(ip);
    return options ?? '';
  }

  async setDeviceOptions(id: string, data: string) {
    return this.execAction(id, (ip) => this.fallback.setDeviceOptions(ip, data), 'set device options');
  }

  async sniffDoor(id: string): Promise<{ unknownUsers: { uid: number; userId: string; name: string }[]; totalUsers: number; knownUsers: number }> {
    const door = await this.getDoorRecord(id);

    const deviceUsers = await this.fallback.getDeviceUsers(door.ipAddress);
    if (deviceUsers.length === 0) {
      return { unknownUsers: [], totalUsers: 0, knownUsers: 0 };
    }

    const knownPersons = await this.prisma.accessPerson.findMany({
      where: { deletedAt: null },
      select: { personId: true, empCode: true, name: true },
    });

    const knownUidSet = new Set(knownPersons.filter(p => p.personId != null).map(p => p.personId));
    const knownEmpCodeSet = new Set(knownPersons.filter(p => p.empCode).map(p => p.empCode!.toLowerCase()));
    const knownNameSet = new Set(knownPersons.filter(p => p.name).map(p => p.name.toLowerCase()));

    const unknownUsers = deviceUsers.filter(u => {
      const uidMatch = knownUidSet.has(u.uid);
      const empCodeMatch = u.userId && knownEmpCodeSet.has(u.userId.toLowerCase());
      const nameMatch = u.name && knownNameSet.has(u.name.toLowerCase());
      return !uidMatch && !empCodeMatch && !nameMatch;
    });

    return {
      unknownUsers: unknownUsers.map(u => ({ uid: u.uid, userId: u.userId, name: u.name })),
      totalUsers: deviceUsers.length,
      knownUsers: deviceUsers.length - unknownUsers.length,
    };
  }

  async addSniffedUsers(doorId: string, users: { uid: number; userId: string; name: string }[]): Promise<{ created: number; details: string[] }> {
    const door = await this.getDoorRecord(doorId);
    const details: string[] = [];
    let created = 0;

    for (const user of users) {
      const existingPerson = await this.prisma.accessPerson.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { personId: user.uid },
            { empCode: user.userId },
            { name: user.name },
          ],
        },
      });

      if (existingPerson) {
        details.push(`تم تجاهل ${user.name} — موجود مسبقاً`);
        continue;
      }

      const newPerson = await this.prisma.accessPerson.create({
        data: {
          personType: 'EMPLOYEE',
          name: user.name || `User ${user.uid}`,
          personId: user.uid,
          empCode: user.userId || String(user.uid),
          fingerprintStatus: 'enrolled',
          isActive: true,
          lastSyncAt: new Date(),
          enrollDevice: door.ipAddress,
        },
      });

      // Create permission for source door
      const existingPerm = await this.prisma.accessPermission.findFirst({
        where: { personId: newPerson.id, doorId: door.id },
      });
      if (!existingPerm) {
        await this.prisma.accessPermission.create({
          data: { personId: newPerson.id, doorId: door.id },
        });
      }

      details.push(`تم إضافة ${user.name} (UID: ${user.uid})`);
      created++;
    }

    return { created, details };
  }
}
