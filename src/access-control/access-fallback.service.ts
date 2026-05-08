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

  private errMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try { return JSON.stringify(err); } catch { return String(err); }
  }

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
      this.logger.warn(`Failed to get users from ${ip}: ${this.errMsg(err)}`);
      return [];
    }
  }

  async checkUserOnDevice(ip: string, uid: number, empCode?: string): Promise<{ exists: boolean; name?: string; role?: number }> {
    try {
      const users = await this.getDeviceUsers(ip);
      const match = users.find(u => u.uid === uid || (empCode && u.userId === empCode));
      if (match) {
        return { exists: true, name: match.name };
      }
      return { exists: false };
    } catch {
      return { exists: false };
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
      this.logger.warn(`Failed to push user to ${ip}: ${this.errMsg(err)}`);
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
      this.logger.warn(`Failed to delete templates for UID:${uid} on ${ip}: ${this.errMsg(err)}`);
      }

      await client.disconnect();
      this.logger.log(`Blocked user UID:${uid} (${userId}) (role=15) on device ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to block user on ${ip}: ${this.errMsg(err)}`);
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
      this.logger.warn(`Failed to get attendance logs from ${ip}: ${this.errMsg(err)}`);
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
      this.logger.warn(`Failed to clear attendance logs on ${ip}: ${this.errMsg(err)}`);
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
      this.logger.warn(`Failed to get templates from ${ip}: ${this.errMsg(err)}`);
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
      this.logger.warn(`Failed to upload template to ${ip}: ${this.errMsg(err)}`);
      return false;
    }
  }

  // ── Device Control Methods ──────────────────────────────────────────

  async getFullDeviceInfo(ip: string): Promise<{
    serialNumber: string | null;
    firmware: string | null;
    deviceName: string | null;
    platform: string | null;
    os: string | null;
    userCounts: number | null;
    logCounts: number | null;
    logCapacity: number | null;
  } | null> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();

      // ZK TCP is sequential — fetch one at a time
      let serialNumber: string | null = null;
      let firmware: string | null = null;
      let deviceName: string | null = null;
      let platform: string | null = null;
      let os: string | null = null;
      let info: any = null;

      try { const v = await client.getSerialNumber(); serialNumber = v ? String(v).trim() : null; } catch { /* skip */ }
      try { const v = await client.getFirmware(); firmware = v ? String(v).trim() : null; } catch { /* skip */ }
      try { const v = await client.getDeviceName(); deviceName = v ? String(v).trim() : null; } catch { /* skip */ }
      try { const v = await client.getPlatform(); platform = v ? String(v).trim() : null; } catch { /* skip */ }
      try { const v = await client.getOS(); os = v ? String(v).trim() : null; } catch { /* skip */ }
      try { info = await client.getInfo(); } catch { /* skip */ }

      await client.disconnect();

      let userCounts: number | null = null;
      let logCounts: number | null = null;
      let logCapacity: number | null = null;
      if (info) {
        userCounts = typeof info.userCounts === 'number' ? info.userCounts : (typeof info.userCount === 'number' ? info.userCount : null);
        logCounts = typeof info.logCounts === 'number' ? info.logCounts : (typeof info.logCount === 'number' ? info.logCount : null);
        logCapacity = typeof info.logCapacity === 'number' ? info.logCapacity : null;
      }

      return { serialNumber, firmware, deviceName, platform, os, userCounts, logCounts, logCapacity };
    } catch (err) {
      this.logger.warn(`Failed to get full device info from ${ip}: ${this.errMsg(err)}`);
      return null;
    }
  }

  async getDeviceTime(ip: string): Promise<string | null> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      const time = await client.getTime();
      await client.disconnect();
      if (!time) return null;
      const date = time instanceof Date ? time : new Date(String(time));
      return isNaN(date.getTime()) ? String(time) : date.toISOString();
    } catch (err) {
      this.logger.warn(`Failed to get device time from ${ip}: ${this.errMsg(err)}`);
      return null;
    }
  }

  async setDeviceTime(ip: string): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      // CMD_SET_TIME = 202; encode time as per ZK protocol
      const now = new Date();
      const encoded =
        ((now.getFullYear() % 100) * 12 * 31 + now.getMonth() * 31 + now.getDate() - 1) * (24 * 60 * 60) +
        (now.getHours() * 60 + now.getMinutes()) * 60 +
        now.getSeconds();
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(encoded, 0);
      await client.executeCmd(202, buf);
      await client.disconnect();
      this.logger.log(`Synced time on device ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to set device time on ${ip}: ${this.errMsg(err)}`);
      return false;
    }
  }

  async getDoorState(ip: string): Promise<{ state: number; label: string } | null> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      // CMD_DOORSTATE_RRQ = 75
      const response = await client.executeCmd(75);
      await client.disconnect();

      let state = 0;
      let label = 'unknown';
      if (Buffer.isBuffer(response) && response.length >= 1) {
        state = response[response.length - 1];
        // state 1 = door open, state 0 = door closed
        label = state === 1 ? 'open' : state === 0 ? 'closed' : 'unknown';
      }
      return { state, label };
    } catch (err) {
      this.logger.warn(`Failed to get door state from ${ip}: ${this.errMsg(err)}`);
      return null;
    }
  }

  async unlockDoor(ip: string, delaySeconds = 5): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      // CMD_UNLOCK = 31, data is the delay in seconds as a buffer
      const delayBuf = Buffer.alloc(4);
      delayBuf.writeUInt32LE(delaySeconds, 0);
      await client.executeCmd(31, delayBuf);
      await client.disconnect();
      this.logger.log(`Unlocked door on device ${ip} for ${delaySeconds}s`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to unlock door on ${ip}: ${this.errMsg(err)}`);
      return false;
    }
  }

  async restartDevice(ip: string): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      // CMD_RESTART = 1004 (client.restart() is broken over TCP)
      await client.executeCmd(1004);
      this.logger.log(`Restarted device ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to restart device ${ip}: ${this.errMsg(err)}`);
      return false;
    }
  }

  async freezeDevice(ip: string): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      await client.disableDevice();
      await client.disconnect();
      this.logger.log(`Froze (disabled) device ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to freeze device ${ip}: ${this.errMsg(err)}`);
      return false;
    }
  }

  async unfreezeDevice(ip: string): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      await client.enableDevice();
      await client.disconnect();
      this.logger.log(`Unfroze (enabled) device ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to unfreeze device ${ip}: ${this.errMsg(err)}`);
      return false;
    }
  }

  async testVoice(ip: string): Promise<boolean> {
    try {
      const Zklib = require('zklib-ts/dist/index.cjs.js');
      const zk = new Zklib(ip, 4370, 5000, 10000);
      await zk.createSocket();
      await zk.voiceTest();
      await zk.disconnect();
      this.logger.log(`Tested voice on device ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to test voice on ${ip}: ${this.errMsg(err)}`);
      return false;
    }
  }

  async cancelAlarm(ip: string): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      // Clear alarm state using executeCmd with alarm flag off
      await client.executeCmd(14, Buffer.from('~AlarmFlag=0\x00'));
      await client.disconnect();
      this.logger.log(`Cancelled alarm on device ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to cancel alarm on ${ip}: ${this.errMsg(err)}`);
      return false;
    }
  }

  async powerOffDevice(ip: string): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      // CMD_POWEROFF = 1005 (client.powerOff() may not exist over TCP)
      await client.executeCmd(1005);
      this.logger.log(`Powered off device ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to power off device ${ip}: ${this.errMsg(err)}`);
      return false;
    }
  }

  async getDeviceOptions(ip: string): Promise<string | null> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      let response: Buffer | null = null;
      try {
        response = await client.executeCmd(11);
      } catch {
        // executeCmd can throw if the device returns unexpected data
        try { await client.disconnect(); } catch { /* skip */ }
        return null;
      }
      try { await client.disconnect(); } catch { /* skip */ }
      if (!response || !Buffer.isBuffer(response) || response.length < 16) return null;
      // Skip the 16-byte header, decode the payload
      const payload = response.subarray(16);
      const text = payload.toString('utf-8').replace(/\0+$/, '').trim();
      return text || null;
    } catch (err) {
      this.logger.warn(`Failed to get device options from ${ip}: ${this.errMsg(err)}`);
      return null;
    }
  }

  async setDeviceOptions(ip: string, data: string): Promise<boolean> {
    try {
      const ZKAttendanceClient = require('zk-attendance-sdk');
      const client = new ZKAttendanceClient(ip, 4370, 5000, 5000);
      await client.createSocket();
      // CMD_OPTIONS_WRQ = 12
      const payload = Buffer.from(data + '\x00', 'utf-8');
      await client.executeCmd(12, payload);
      await client.disconnect();
      this.logger.log(`Set options on device ${ip}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to set device options on ${ip}: ${this.errMsg(err)}`);
      return false;
    }
  }
}
