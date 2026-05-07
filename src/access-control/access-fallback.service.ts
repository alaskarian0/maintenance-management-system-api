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
  deviceUserId: number | string;
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

  async deleteUserFromDevice(ip: string, uid: number, name?: string, empCode?: string): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();

      // Try deleteUser first
      try {
        await client.deleteUser(uid);
        await client.disconnect();
        this.logger.log(`Deleted user UID:${uid} from device ${ip} via ZK SDK`);
        return true;
      } catch {
        // deleteUser not supported over TCP, fall back to blocking (role=15)
        this.logger.warn(`deleteUser not supported, blocking UID:${uid} via role=15`);
      }

      const userId = empCode || String(uid);
      await client.setUser(uid, userId, 'BLOCKED', '', 15, 0);

      // Delete fingerprint templates from device so blocked user can't authenticate
      try {
        const Zklib = require('zklib-ts/dist/index.cjs.js');
        const zk = new Zklib(ip, 4370, 5000, 10000);
        await zk.createSocket();
        await zk.getUsers();
        let deletedCount = 0;
        for (let fid = 0; fid < 10; fid++) {
          try {
            await zk.deleteFinger(userId, fid);
            deletedCount++;
          } catch {
            // No template at this index
          }
        }
        await zk.disconnect();
        this.logger.log(`Deleted ${deletedCount}/10 fingerprint slots for user ${userId} (UID:${uid}) on device ${ip}`);
      } catch (err) {
        this.logger.warn(`Failed to delete templates for UID:${uid} on ${ip}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      }

      await client.disconnect();
      this.logger.log(`Blocked user UID:${uid} (${userId}) (role=15) on device ${ip}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));
      this.logger.warn(`Failed to block user on ${ip}: ${msg}`);
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
        deviceUserId: log.deviceUserId || log.userSn || 0,
        deviceSerialNumber: null,
        timestamp: log.recordTime ? new Date(log.recordTime) : (log.attTime ? new Date(log.attTime) : new Date()),
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

  async getFingerprintTemplates(ip: string): Promise<{ uid: number; fid: number; valid: number; template_base64: string }[]> {
    try {
      const Zklib = require('zklib-ts/dist/index.cjs.js');
      const zk = new Zklib(ip, 4370, 5000, 10000);
      await zk.createSocket();
      const templates = await zk.getTemplates();
      await zk.disconnect();

      const result: { uid: number; fid: number; valid: number; template_base64: string }[] = [];
      const data = templates.data || templates;

      for (const [userPin, fingers] of Object.entries(data)) {
        for (const finger of (fingers as any[])) {
          if (finger.template && finger.template.length > 0) {
            result.push({
              uid: finger.uid || parseInt(userPin) || 0,
              fid: finger.fid,
              valid: finger.valid,
              template_base64: finger.template.toString('base64'),
            });
          }
        }
      }

      this.logger.log(`Got ${result.length} fingerprint templates from ${ip}`);
      return result;
    } catch (err) {
      this.logger.warn(`Failed to get templates from ${ip}: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  async uploadFingerprintTemplate(ip: string, userId: string, name: string, templateBase64: string, fid: number, valid: number): Promise<boolean> {
    try {
      const Zklib = require('zklib-ts/dist/index.cjs.js');
      const zk = new Zklib(ip, 4370, 5000, 10000);
      await zk.createSocket();

      // Load user cache from device
      try {
        await zk.getUsers();
      } catch { /* ignore */ }

      // Ensure user exists on device before uploading template
      try {
        await zk.setUser(userId, name.substring(0, 24), '', 0, 0);
      } catch {
        // User may already exist — refresh cache and continue
        try { await zk.getUsers(); } catch { /* ignore */ }
      }

      await zk.uploadFingerTemplate(userId, templateBase64, fid, valid);
      await zk.disconnect();
      this.logger.log(`Uploaded fingerprint template fid=${fid} for user ${userId} to ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to upload template to ${ip}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      return false;
    }
  }
}
