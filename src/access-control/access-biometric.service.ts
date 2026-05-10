import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface StoredFinger {
  fid: number;
  valid: number;
  template_base64: string;
}

export interface StoredTemplates {
  fingers: StoredFinger[];
  face: string | null;
  pulledFrom: string;
  pulledAt: string;
}

@Injectable()
export class AccessBiometricService {
  private readonly logger = new Logger(AccessBiometricService.name);

  constructor(private prisma: PrismaService) {}

  async pullAndStoreTemplates(personId: string, deviceIp: string): Promise<{ fingers: number; face: boolean }> {
    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new Error('Person not found');

    const uid = person.personId || 0;
    if (uid === 0) {
      this.logger.warn(`Person "${person.name}" has no UID, skipping template pull`);
      return { fingers: 0, face: false };
    }

    const Zklib = require('zklib-ts/dist/index.cjs.js');
    const zk = new Zklib(deviceIp, 4370, 5000, 10000);

    try {
      await zk.createSocket();
    } catch (err) {
      this.logger.warn(`Cannot connect to ${deviceIp} for template pull: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      return { fingers: 0, face: false };
    }

    let fingers: StoredFinger[] = [];
    let face: string | null = null;

    try {
      const templates = await zk.getTemplates();
      const data = templates.data || templates;

      // zklib-ts returns Record<string, Finger[]> where key is user pin/id
      const userKey = String(person.empCode || uid);
      const userFingers = data[userKey] || data[uid] || [];

      for (const finger of userFingers) {
        if (finger.template && finger.template.length > 0) {
          fingers.push({
            fid: finger.fid,
            valid: finger.valid,
            template_base64: finger.template.toString('base64'),
          });
        }
      }

      // If no fingers found by key, try pulling individual finger slots
      if (fingers.length === 0) {
        for (let fid = 0; fid < 10; fid++) {
          try {
            const tmpl = await zk.getUserTemplate(String(person.empCode || uid), fid);
            if (tmpl && tmpl.length > 0) {
              fingers.push({
                fid,
                valid: 1,
                template_base64: tmpl.toString('base64'),
              });
            }
          } catch {
            // No template at this finger index
          }
        }
      }

      this.logger.log(`Pulled ${fingers.length} fingerprint templates for "${person.name}" from ${deviceIp}`);
    } catch (err) {
      this.logger.warn(`Failed to pull templates from ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
    }

    try {
      await zk.disconnect();
    } catch {
      // Ignore disconnect errors
    }

    const storedData: StoredTemplates = {
      fingers,
      face,
      pulledFrom: deviceIp,
      pulledAt: new Date().toISOString(),
    };

    if (fingers.length > 0 || face) {
      await this.prisma.accessPerson.update({
        where: { id: personId },
        data: { fingerprintTemplates: storedData as any },
      });
      this.logger.log(`Saved ${fingers.length} fingerprint templates to DB for "${person.name}"`);
    }

    return { fingers: fingers.length, face: face !== null };
  }

  async restoreTemplates(personId: string, deviceIp: string): Promise<{ fingers: number; face: boolean }> {
    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new Error('Person not found');

    const stored = person.fingerprintTemplates as unknown as StoredTemplates | null;
    if (!stored || (!stored.fingers?.length && !stored.face)) {
      this.logger.log(`No stored templates for "${person.name}", nothing to restore`);
      return { fingers: 0, face: false };
    }

    const Zklib = require('zklib-ts/dist/index.cjs.js');
    const zk = new Zklib(deviceIp, 4370, 5000, 10000);

    try {
      await zk.createSocket();
    } catch (err) {
      this.logger.warn(`Cannot connect to ${deviceIp} for template restore: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      return { fingers: 0, face: false };
    }

    let restoredFingers = 0;
    let restoredFace = false;

    const userId = String(person.empCode || person.personId || '');
    const uid = person.personId || 0;

    // Load existing users from device to populate internal cache
    let deviceUsers: any[] = [];
    try {
      const usersResult = await zk.getUsers();
      deviceUsers = Array.isArray(usersResult) ? usersResult : (usersResult?.data || []);
      this.logger.log(`Loaded user cache from ${deviceIp}`);
    } catch (err) {
      this.logger.warn(`Failed to load users from ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
    }

    // The device may store the user with a different userId than our empCode
    // (e.g., if originally synced without empCode, userId would be the numeric uid).
    // Resolve the actual userId from the device by matching on uid.
    const matchingDeviceUser = deviceUsers.find(
      (u: any) => String(u.userId || u.user_id || '') === userId || u.uid === uid
    );

    let deviceUserId = userId;
    if (matchingDeviceUser) {
      deviceUserId = String((matchingDeviceUser as any).userId || (matchingDeviceUser as any).user_id || userId);
      this.logger.log(`Found user on device ${deviceIp}: uid=${(matchingDeviceUser as any).uid}, userId=${deviceUserId}`);
    }

    // Ensure user exists on device using zklib-ts setUser with the correct userId
    try {
      await zk.setUser(deviceUserId, person.name.substring(0, 24), '', 0, 0);
      this.logger.log(`Ensured user "${person.name}" (${deviceUserId}) exists on ${deviceIp}`);
    } catch (err) {
      this.logger.warn(`setUser failed for "${person.name}" on ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      // Refresh cache so uploadFingerTemplate can find the user
      try { await zk.getUsers(); } catch { /* ignore */ }
    }

    // Upload fingerprint templates using the device's actual userId
    if (stored.fingers?.length) {
      for (const finger of stored.fingers) {
        try {
          const templateBuffer = Buffer.from(finger.template_base64, 'base64');
          const templateBase64 = templateBuffer.toString('base64');
          await zk.uploadFingerTemplate(deviceUserId, templateBase64, finger.fid, finger.valid);
          restoredFingers++;
        } catch (err) {
          this.logger.warn(`Failed to upload finger ${finger.fid} to ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
        }
      }
    }

    try {
      await zk.disconnect();
    } catch {
      // Ignore
    }

    if (restoredFingers > 0 || restoredFace) {
      this.logger.log(`Restored ${restoredFingers} fingerprints for "${person.name}" on ${deviceIp}`);
    }

    return { fingers: restoredFingers, face: restoredFace };
  }

  async transferTemplates(personId: string, targetDeviceIp: string): Promise<{ fingers: number; face: boolean }> {
    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new Error('Person not found');

    const stored = person.fingerprintTemplates as unknown as StoredTemplates | null;
    if (!stored || (!stored.fingers?.length && !stored.face)) {
      return { fingers: 0, face: false };
    }

    return this.restoreTemplates(personId, targetDeviceIp);
  }

  async getStoredTemplates(personId: string): Promise<StoredTemplates | null> {
    const person = await this.prisma.accessPerson.findUnique({
      where: { id: personId },
      select: { fingerprintTemplates: true },
    });
    if (!person) return null;
    return (person.fingerprintTemplates as unknown as StoredTemplates) ?? null;
  }

  async enrollFingerprint(personId: string, deviceIp: string, fingerIndex: number): Promise<{ success: boolean; fingerIndex: number; message: string }> {
    if (fingerIndex < 0 || fingerIndex > 9) {
      return { success: false, fingerIndex, message: 'فهرس الإصبع خارج النطاق (0-9)' };
    }

    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new Error('Person not found');

    const userId = String(person.empCode || person.personId || '');
    if (!userId) {
      return { success: false, fingerIndex, message: 'الشخص ليس لديه رقم موظف أو UID' };
    }

    const Zklib = require('zklib-ts/dist/index.cjs.js');
    // 90s timeout — enrollment requires placing finger 3 times on device
    const zk = new Zklib(deviceIp, 4370, 90000, 10000);

    try {
      await zk.createSocket();
    } catch (err) {
      const msg = `لا يمكن الاتصال بالجهاز ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`;
      this.logger.warn(msg);
      return { success: false, fingerIndex, message: msg };
    }

    try {
      // Load user cache from device
      try {
        await zk.getUsers();
        this.logger.log(`Loaded user cache from ${deviceIp} for enrollment`);
      } catch {
        this.logger.warn(`Failed to load users from ${deviceIp}, continuing anyway`);
      }

      // Ensure user exists on device
      try {
        await zk.setUser(userId, person.name.substring(0, 24), '', 0, 0);
        this.logger.log(`Ensured user "${person.name}" (${userId}) exists on ${deviceIp}`);
      } catch (err) {
        this.logger.warn(`setUser failed for "${person.name}" on ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
        try { await zk.getUsers(); } catch { /* refresh cache */ }
      }

      // Start enrollment — device will prompt "place your finger" 3 times
      this.logger.log(`Starting fingerprint enrollment for "${person.name}" finger ${fingerIndex} on ${deviceIp}`);

      let enrolledBySDK = false;
      try {
        enrolledBySDK = await zk.enrollUser(userId, fingerIndex);
        this.logger.log(`enrollUser returned: ${enrolledBySDK}`);
      } catch (enrollErr) {
        // enrollUser may throw even when enrollment succeeded on the device.
        // Some ZKTeco models send packets with unexpected sizes causing a read error,
        // but the fingerprint is registered successfully. We will verify by pulling template.
        this.logger.warn(`enrollUser threw (may still have succeeded on device): ${enrollErr instanceof Error ? enrollErr.message : JSON.stringify(enrollErr)}`);
      }

      // CRITICAL: Always pull the template from device to confirm enrollment.
      // If the template is found, the fingerprint was registered regardless of enrollUser result.
      await new Promise(r => setTimeout(r, 1500)); // brief wait for device to finalize

      let templateBase64: string | null = null;
      let templateFound = false;
      try {
        const templateBuffer = await zk.getUserTemplate(userId, fingerIndex);
        if (templateBuffer && templateBuffer.length > 0) {
          templateBase64 = templateBuffer.toString('base64');
          templateFound = true;
          this.logger.log(`Pulled enrolled template for finger ${fingerIndex} (${templateBuffer.length} bytes)`);
        }
      } catch (err) {
        this.logger.warn(`Failed to pull enrolled template for finger ${fingerIndex}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      }

      // Success = SDK confirmed OR template found on device
      const success = enrolledBySDK || templateFound;

      if (!success) {
        this.logger.warn(`Enrollment failed for "${person.name}" finger ${fingerIndex} — no template found on device`);
        return {
          success: false,
          fingerIndex,
          message: 'فشل تسجيل البصمة — لم يتم التحقق من الإصبع. يرجى المحاولة مجدداً ووضع الإصبع 3 مرات بشكل واضح.',
        };
      }

      this.logger.log(`Enrollment confirmed for "${person.name}" finger ${fingerIndex} (sdk=${enrolledBySDK}, template=${templateFound})`);

      // Update stored templates in DB
      const existing = person.fingerprintTemplates as unknown as StoredTemplates | null;
      const existingFingers = existing?.fingers || [];
      const filteredFingers = existingFingers.filter(f => f.fid !== fingerIndex);

      if (templateBase64) {
        filteredFingers.push({
          fid: fingerIndex,
          valid: 1,
          template_base64: templateBase64,
        });
      }

      const storedData: StoredTemplates = {
        fingers: filteredFingers,
        face: existing?.face || null,
        pulledFrom: deviceIp,
        pulledAt: new Date().toISOString(),
      };

      await this.prisma.accessPerson.update({
        where: { id: personId },
        data: {
          fingerprintTemplates: storedData as any,
          fingerprintStatus: 'enrolled',
          enrollDevice: deviceIp,
          lastSyncAt: new Date(),
        },
      });

      this.logger.log(`Saved enrolled fingerprint to DB for "${person.name}" (finger ${fingerIndex})`);

      const FINGER_LABELS_AR: Record<number, string> = {
        0: 'إبهام يمين', 1: 'سبابة يمين', 2: 'وسطى يمين', 3: 'بنصر يمين', 4: 'خنصر يمين',
        5: 'إبهام يسار', 6: 'سبابة يسار', 7: 'وسطى يسار', 8: 'بنصر يسار', 9: 'خنصر يسار',
      };
      return {
        success: true,
        fingerIndex,
        message: `تم تسجيل البصمة بنجاح — ${FINGER_LABELS_AR[fingerIndex] || `الإصبع ${fingerIndex}`}${templateBase64 ? '' : ' (القالب غير متوفر محلياً)'}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      this.logger.error(`Enrollment error for "${person.name}" on ${deviceIp}: ${msg}`);
      return { success: false, fingerIndex, message: `خطأ أثناء التسجيل: ${msg}` };
    } finally {
      try {
        await zk.disconnect();
      } catch {
        // Ignore
      }
    }
  }
}
