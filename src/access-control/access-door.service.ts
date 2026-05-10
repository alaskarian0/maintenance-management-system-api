import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AccessFallbackService } from './access-fallback.service';
import { CreateDoorDto } from './dto/create-door.dto';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

@Injectable()
export class AccessDoorService {
  constructor(
    private prisma: PrismaService,
    private fallback: AccessFallbackService,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────

  /** Flatten first-device fields onto the door object so the frontend
   *  can read door.ipAddress / door.state / door.serialNumber directly. */
  private flattenDoor(door: any) {
    const primary = door.devices?.[0];
    return {
      ...door,
      ipAddress: primary?.ipAddress ?? null,
      serialNumber: primary?.serialNumber ?? null,
      zkTerminalId: primary?.zkTerminalId ?? null,
      state: primary?.state ?? 3,
      lastActivity: primary?.lastActivity ?? null,
      isAttendance: primary?.isAttendance ?? true,
    };
  }

  // ── Door CRUD ────────────────────────────────────────────────────

  async findAll() {
    const doors = await this.prisma.accessDoor.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        devices: { orderBy: { side: 'asc' } },
        _count: { select: { permissions: true, logs: true } },
      },
    });
    return doors.map((d: any) => this.flattenDoor(d));
  }

  async findOne(id: string) {
    const door = await this.prisma.accessDoor.findUnique({
      where: { id },
      include: {
        devices: { orderBy: { side: 'asc' } },
        permissions: { include: { person: true } },
      },
    });
    return door ? this.flattenDoor(door) : null;
  }

  async create(dto: CreateDoorDto) {
    const door = await this.prisma.accessDoor.create({
      data: {
        name: dto.name,
        location: dto.location,
      },
    });

    return this.findOne(door.id);
  }

  async update(id: string, data: { name?: string; location?: string; group?: 'INSIDE' | 'OUTSIDE' }) {
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

  // ── Device CRUD ──────────────────────────────────────────────────

  async createDevice(doorId: string, dto: CreateDeviceDto) {
    const door = await this.prisma.accessDoor.findUnique({ where: { id: doorId } });
    if (!door) throw new NotFoundException('Door not found');
    return this.prisma.accessDevice.create({
      data: {
        doorId,
        name: dto.name,
        side: dto.side || 'INSIDE',
        serialNumber: dto.serialNumber,
        ipAddress: dto.ipAddress,
        zkTerminalId: dto.zkTerminalId,
        isAttendance: dto.isAttendance ?? true,
      },
    });
  }

  async updateDevice(doorId: string, deviceId: string, dto: UpdateDeviceDto) {
    const device = await this.prisma.accessDevice.findFirst({
      where: { id: deviceId, doorId },
    });
    if (!device) throw new NotFoundException('Device not found');
    return this.prisma.accessDevice.update({
      where: { id: deviceId },
      data: dto,
    });
  }

  async removeDevice(doorId: string, deviceId: string) {
    const device = await this.prisma.accessDevice.findFirst({
      where: { id: deviceId, doorId },
    });
    if (!device) throw new NotFoundException('Device not found');
    return this.prisma.accessDevice.delete({ where: { id: deviceId } });
  }

  // ── Device helpers ───────────────────────────────────────────────

  private async getDeviceRecord(id: string) {
    const device = await this.prisma.accessDevice.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (!device.ipAddress) throw new NotFoundException('Device has no IP address configured');
    return device;
  }

  private async execAction(deviceId: string, fn: (ip: string) => Promise<boolean>, label: string) {
    const device = await this.getDeviceRecord(deviceId);
    const ok = await fn(device.ipAddress!);
    if (!ok) throw new Error(`Failed to ${label}`);
    return { success: true };
  }

  // ── Ping / Status ────────────────────────────────────────────────

  async pingDevice(deviceId: string): Promise<{ reachable: boolean; ip: string; responseMs: number | null; message: string }> {
    const device = await this.prisma.accessDevice.findUnique({ where: { id: deviceId } });
    if (!device) {
      return { reachable: false, ip: '', responseMs: null, message: 'Device not found' };
    }

    const ip = device.ipAddress || device.name;
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      await fetch(`http://${ip}`, { signal: controller.signal });
      clearTimeout(timeout);
      const responseMs = Date.now() - start;

      if (device.state !== 1) {
        await this.prisma.accessDevice.update({
          where: { id: deviceId },
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

        if (device.state !== 1) {
          await this.prisma.accessDevice.update({
            where: { id: deviceId },
            data: { state: 1, lastActivity: new Date() },
          });
        }

        return { reachable: true, ip, responseMs: tcpMs, message: `Device reachable via ZK port (${tcpMs}ms)` };
      } catch {
        if (device.state !== 3) {
          await this.prisma.accessDevice.update({
            where: { id: deviceId },
            data: { state: 3 },
          });
        }

        return { reachable: false, ip, responseMs: null, message: `Device not reachable (${ip})` };
      }
    }
  }

  async pingAllDevices(): Promise<{ id: string; doorId: string; name: string; reachable: boolean; ip: string; responseMs: number | null }[]> {
    const devices = await this.prisma.accessDevice.findMany();
    const results = [];

    for (const device of devices) {
      const result = await this.pingDevice(device.id);
      results.push({
        id: device.id,
        doorId: device.doorId,
        name: device.name,
        reachable: result.reachable,
        ip: result.ip,
        responseMs: result.responseMs,
      });
    }

    return results;
  }

  async discoverDeviceInfo(deviceId: string): Promise<{ serialNumber: string | null; firmware: string | null; deviceName: string | null } | null> {
    const device = await this.prisma.accessDevice.findUnique({ where: { id: deviceId } });
    if (!device?.ipAddress) return null;

    const info = await this.fallback.getDeviceInfo(device.ipAddress);

    if (info?.serialNumber && !device.serialNumber) {
      await this.prisma.accessDevice.update({
        where: { id: deviceId },
        data: { serialNumber: info.serialNumber },
      });
    }

    return info;
  }

  // ── Device Control Methods ───────────────────────────────────────

  async getFullDeviceInfo(deviceId: string) {
    const device = await this.getDeviceRecord(deviceId);
    const info = await this.fallback.getFullDeviceInfo(device.ipAddress!);
    if (!info) return null;
    if (info.serialNumber && !device.serialNumber) {
      await this.prisma.accessDevice.update({
        where: { id: deviceId },
        data: { serialNumber: info.serialNumber },
      });
    }
    return info;
  }

  async getDeviceTime(deviceId: string) {
    const device = await this.getDeviceRecord(deviceId);
    return this.fallback.getDeviceTime(device.ipAddress!);
  }

  async setDeviceTime(deviceId: string) {
    return this.execAction(deviceId, (ip) => this.fallback.setDeviceTime(ip), 'set device time');
  }

  async getDoorState(deviceId: string) {
    const device = await this.getDeviceRecord(deviceId);
    const state = await this.fallback.getDoorState(device.ipAddress!);
    return state ?? { state: -1, label: 'unknown' };
  }

  async unlockDoor(deviceId: string) {
    return this.execAction(deviceId, (ip) => this.fallback.unlockDoor(ip), 'unlock door');
  }

  async restartDevice(deviceId: string) {
    const result = await this.execAction(deviceId, (ip) => this.fallback.restartDevice(ip), 'restart device');
    await this.prisma.accessDevice.update({ where: { id: deviceId }, data: { state: 3 } }).catch(() => {});
    return result;
  }

  async freezeDevice(deviceId: string) {
    return this.execAction(deviceId, (ip) => this.fallback.freezeDevice(ip), 'freeze device');
  }

  async unfreezeDevice(deviceId: string) {
    return this.execAction(deviceId, (ip) => this.fallback.unfreezeDevice(ip), 'unfreeze device');
  }

  async testVoice(deviceId: string) {
    return this.execAction(deviceId, (ip) => this.fallback.testVoice(ip), 'test voice');
  }

  async cancelAlarm(deviceId: string) {
    return this.execAction(deviceId, (ip) => this.fallback.cancelAlarm(ip), 'cancel alarm');
  }

  async powerOffDevice(deviceId: string) {
    const result = await this.execAction(deviceId, (ip) => this.fallback.powerOffDevice(ip), 'power off device');
    await this.prisma.accessDevice.update({ where: { id: deviceId }, data: { state: 3 } }).catch(() => {});
    return result;
  }

  async getDeviceOptions(deviceId: string) {
    const device = await this.getDeviceRecord(deviceId);
    const options = await this.fallback.getDeviceOptions(device.ipAddress!);
    return options ?? '';
  }

  async setDeviceOptions(deviceId: string, data: string) {
    return this.execAction(deviceId, (ip) => this.fallback.setDeviceOptions(ip, data), 'set device options');
  }

  async sniffDevice(deviceId: string): Promise<{ unknownUsers: { uid: number; userId: string; name: string }[]; totalUsers: number; knownUsers: number }> {
    const device = await this.getDeviceRecord(deviceId);

    const deviceUsers = await this.fallback.getDeviceUsers(device.ipAddress!);
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

  async addSniffedUsers(deviceId: string, users: { uid: number; userId: string; name: string }[]): Promise<{ created: number; details: string[] }> {
    const device = await this.getDeviceRecord(deviceId);
    const door = await this.prisma.accessDoor.findUnique({ where: { id: device.doorId } });
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
          enrollDevice: device.ipAddress,
        },
      });

      // Create permission for the door
      if (door) {
        const existingPerm = await this.prisma.accessPermission.findFirst({
          where: { personId: newPerson.id, doorId: door.id },
        });
        if (!existingPerm) {
          await this.prisma.accessPermission.create({
            data: { personId: newPerson.id, doorId: door.id },
          });
        }
      }

      details.push(`تم إضافة ${user.name} (UID: ${user.uid})`);
      created++;
    }

    return { created, details };
  }
}
