import { Injectable, Logger } from '@nestjs/common';

export interface DevicePingResult {
  reachable: boolean;
  ip: string;
  responseMs: number | null;
  method: 'http' | 'zk-tcp' | 'none';
  message: string;
}

export interface DeviceUserInfo {
  uid: number;
  userId: string;
  name: string;
}

export interface DeviceAttendanceRecord {
  deviceUserId: number;
  deviceSerialNumber: string | null;
  timestamp: Date;
  state: number;
  verifyType: number;
}

@Injectable()
export class AccessFallbackService {
  private readonly logger = new Logger(AccessFallbackService.name);

  async pingDevice(ip: string): Promise<DevicePingResult> {
    const start = Date.now();

    // Tier 1: HTTP ping
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      await fetch(`http://${ip}`, { signal: controller.signal });
      clearTimeout(timeout);
      return {
        reachable: true,
        ip,
        responseMs: Date.now() - start,
        method: 'http',
        message: `Device reachable via HTTP (${Date.now() - start}ms)`,
      };
    } catch {
      // HTTP failed, try ZK TCP
    }

    // Tier 2: ZK TCP direct connection
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 3000, 2000);
      await client.createSocket();
      await client.disconnect();
      const tcpMs = Date.now() - start;
      return {
        reachable: true,
        ip,
        responseMs: tcpMs,
        method: 'zk-tcp',
        message: `Device reachable via ZK TCP (${tcpMs}ms)`,
      };
    } catch {
      return {
        reachable: false,
        ip,
        responseMs: null,
        method: 'none',
        message: `Device not reachable (${ip})`,
      };
    }
  }

  async getDeviceUsers(ip: string): Promise<DeviceUserInfo[]> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      const users = await client.getUsers();
      await client.disconnect();
      return (users?.data || []).map((u: any) => ({
        uid: u.uid || 0,
        userId: u.userId || String(u.uid),
        name: u.name || '',
      }));
    } catch (err) {
      this.logger.warn(`Failed to get users from ${ip}: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  async pushUserToDevice(ip: string, uid: number, userId: string, name: string): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      await client.setUser(uid, userId, name.substring(0, 24), '', 0, 0);
      await client.disconnect();
      this.logger.log(`Pushed user "${name}" (${userId}) to device ${ip} via ZK SDK`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to push user to ${ip}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  async deleteUserFromDevice(ip: string, uid: number): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      await client.deleteUser(uid);
      await client.disconnect();
      this.logger.log(`Deleted user UID:${uid} from device ${ip} via ZK SDK`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to delete user from ${ip}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  async getDeviceAttendanceCount(ip: string): Promise<number> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      const size = await client.getAttendanceSize();
      await client.disconnect();
      return size || 0;
    } catch {
      return -1;
    }
  }

  async getDeviceSerialNumber(ip: string): Promise<string | null> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      const sn = await client.getSerialNumber();
      await client.disconnect();
      return sn ? sn.trim() : null;
    } catch {
      return null;
    }
  }

  async getDeviceAttendanceLogs(ip: string): Promise<DeviceAttendanceRecord[]> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      const result = await client.getAttendances();
      await client.disconnect();

      const logs = result?.data || [];
      return logs.map((log: any) => ({
        deviceUserId: log.deviceUserId || log.uid || 0,
        deviceSerialNumber: null,
        timestamp: log.attTime ? new Date(log.attTime) : new Date(),
        state: log.state || 0,
        verifyType: log.verifyMethod ?? log.verifyType ?? 0,
      }));
    } catch (err) {
      this.logger.warn(`Failed to get attendance logs from ${ip}: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  async clearDeviceAttendanceLogs(ip: string): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      await client.clearAttendanceLog();
      await client.disconnect();
      this.logger.log(`Cleared attendance logs on device ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to clear attendance logs on ${ip}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  async getDeviceInfo(ip: string): Promise<{ serialNumber: string | null; firmware: string | null; deviceName: string | null } | null> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      const [serialNumber, firmware, deviceName] = await Promise.all([
        client.getSerialNumber().catch(() => null),
        client.getFirmware().catch(() => null),
        client.getDeviceName().catch(() => null),
      ]);
      await client.disconnect();
      return {
        serialNumber: serialNumber ? String(serialNumber).trim() : null,
        firmware: firmware ? String(firmware).trim() : null,
        deviceName: deviceName ? String(deviceName).trim() : null,
      };
    } catch {
      return null;
    }
  }
}
