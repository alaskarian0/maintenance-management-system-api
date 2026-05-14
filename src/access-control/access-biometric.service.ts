import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { createHash } from 'crypto';

export interface StoredFinger {
  fid: number;
  valid: number;
  template_base64: string;
}

export interface StoredFace {
  faceId: number;
  valid: number;
  template_base64: string;
  size: number;
}

export interface StoredTemplates {
  fingers: StoredFinger[];
  faces: StoredFace[];
  pulledFrom: string;
  pulledAt: string;
}

@Injectable()
export class AccessBiometricService {
  private readonly logger = new Logger(AccessBiometricService.name);

  constructor(private prisma: PrismaService) {}

  private hashTemplate(base64: string): string {
    return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
  }

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
    let faces: StoredFace[] = [];

    try {
      const templates = await zk.getTemplates();
      const data = templates.data || templates;

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
      faces,
      pulledFrom: deviceIp,
      pulledAt: new Date().toISOString(),
    };

    if (fingers.length > 0 || faces.length > 0) {
      await this.prisma.accessPerson.update({
        where: { id: personId },
        data: { fingerprintTemplatesData: storedData as any },
      });
      this.logger.log(`Saved ${fingers.length} fingerprint templates to DB for "${person.name}"`);
    }

    return { fingers: fingers.length, face: faces.length > 0 };
  }

  async restoreTemplates(personId: string, deviceIp: string): Promise<{ fingers: number; face: boolean }> {
    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new Error('Person not found');

    const stored = person.fingerprintTemplatesData as unknown as StoredTemplates | null;
    if (!stored || (!stored.fingers?.length && !stored.faces?.length)) {
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

    let deviceUsers: any[] = [];
    try {
      const usersResult = await zk.getUsers();
      deviceUsers = Array.isArray(usersResult) ? usersResult : (usersResult?.data || []);
      this.logger.log(`Loaded user cache from ${deviceIp}`);
    } catch (err) {
      this.logger.warn(`Failed to load users from ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
    }

    const matchingDeviceUser = deviceUsers.find(
      (u: any) => String(u.userId || u.user_id || '') === userId || u.uid === uid
    );

    let deviceUserId = userId;
    if (matchingDeviceUser) {
      deviceUserId = String((matchingDeviceUser as any).userId || (matchingDeviceUser as any).user_id || userId);
      this.logger.log(`Found user on device ${deviceIp}: uid=${(matchingDeviceUser as any).uid}, userId=${deviceUserId}`);
    }

    try {
      await zk.setUser(deviceUserId, person.name.substring(0, 24), '', 0, 0);
      this.logger.log(`Ensured user "${person.name}" (${deviceUserId}) exists on ${deviceIp}`);
    } catch (err) {
      this.logger.warn(`setUser failed for "${person.name}" on ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      try { await zk.getUsers(); } catch { /* ignore */ }
    }

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

    // Restore face templates from dedicated FaceTemplate table
    const faceTemplates = await this.prisma.faceTemplate.findMany({ where: { personId } });
    if (faceTemplates.length > 0) {
      for (const ft of faceTemplates) {
        try {
          const templateBuffer = Buffer.from(ft.templateData, 'base64');
          await zk.executeCmd(202, templateBuffer);
          restoredFace = true;
        } catch (err) {
          this.logger.warn(`Failed to restore face template ${ft.faceIndex} to ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
        }
      }
    }

    try {
      await zk.disconnect();
    } catch {
      // Ignore
    }

    if (restoredFingers > 0 || restoredFace) {
      this.logger.log(`Restored ${restoredFingers} fingerprints and ${restoredFace ? 'face' : 'no face'} for "${person.name}" on ${deviceIp}`);
    }

    return { fingers: restoredFingers, face: restoredFace };
  }

  async transferTemplates(personId: string, targetDeviceIp: string): Promise<{ fingers: number; face: boolean }> {
    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new Error('Person not found');

    const stored = person.fingerprintTemplatesData as unknown as StoredTemplates | null;
    const hasFaceTemplates = (await this.prisma.faceTemplate.count({ where: { personId } })) > 0;
    if (!stored || (!stored.fingers?.length && !stored.faces?.length && !hasFaceTemplates)) {
      return { fingers: 0, face: false };
    }

    return this.restoreTemplates(personId, targetDeviceIp);
  }

  async getStoredTemplates(personId: string): Promise<StoredTemplates | null> {
    const person = await this.prisma.accessPerson.findUnique({
      where: { id: personId },
      select: { fingerprintTemplatesData: true },
    });
    if (!person) return null;
    return (person.fingerprintTemplatesData as unknown as StoredTemplates) ?? null;
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
    const zk = new Zklib(deviceIp, 4370, 90000, 10000);

    try {
      await zk.createSocket();
    } catch (err) {
      const msg = `لا يمكن الاتصال بالجهاز ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`;
      this.logger.warn(msg);
      return { success: false, fingerIndex, message: msg };
    }

    try {
      try {
        await zk.getUsers();
        this.logger.log(`Loaded user cache from ${deviceIp} for enrollment`);
      } catch {
        this.logger.warn(`Failed to load users from ${deviceIp}, continuing anyway`);
      }

      try {
        await zk.setUser(userId, person.name.substring(0, 24), '', 0, 0);
        this.logger.log(`Ensured user "${person.name}" (${userId}) exists on ${deviceIp}`);
      } catch (err) {
        this.logger.warn(`setUser failed for "${person.name}" on ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
        try { await zk.getUsers(); } catch { /* refresh cache */ }
      }

      this.logger.log(`Starting fingerprint enrollment for "${person.name}" finger ${fingerIndex} on ${deviceIp}`);

      let enrolledBySDK = false;
      try {
        enrolledBySDK = await zk.enrollUser(userId, fingerIndex);
        this.logger.log(`enrollUser returned: ${enrolledBySDK}`);
      } catch (enrollErr) {
        this.logger.warn(`enrollUser threw (may still have succeeded on device): ${enrollErr instanceof Error ? enrollErr.message : JSON.stringify(enrollErr)}`);
      }

      await new Promise(r => setTimeout(r, 1500));

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

      const existing = person.fingerprintTemplatesData as unknown as StoredTemplates | null;
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
        faces: existing?.faces || [],
        pulledFrom: deviceIp,
        pulledAt: new Date().toISOString(),
      };

      await this.prisma.accessPerson.update({
        where: { id: personId },
        data: {
          fingerprintTemplatesData: storedData as any,
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

  async withdrawFingerprint(personId: string, deviceIp: string): Promise<{ success: boolean; message: string }> {
    let pullCount = 0;
    try {
      const pullResult = await this.pullAndStoreTemplates(personId, deviceIp);
      pullCount = pullResult.fingers;
      this.logger.log(`Pulled ${pullCount} fingers before withdrawing for person ${personId}`);
    } catch (err) {
      this.logger.warn(`Failed to pull templates before withdrawing: ${err}`);
    }

    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new Error('Person not found');

    const uid = person.personId || 0;
    if (uid === 0) {
      return { success: false, message: 'الشخص ليس لديه UID صالح' };
    }

    const Zklib = require('zklib-ts/dist/index.cjs.js');
    const zk = new Zklib(deviceIp, 4370, 5000, 10000);

    try {
      await zk.createSocket();
    } catch (err) {
      const msg = `لا يمكن الاتصال بالجهاز ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`;
      this.logger.warn(msg);
      return { success: false, message: msg };
    }

    let deletedCount = 0;
    try {
      const usersResult = await zk.getUsers();
      const deviceUsers = Array.isArray(usersResult) ? usersResult : (usersResult?.data || []);

      const targetUserId = String(person.empCode || uid);
      const matchingDeviceUser = deviceUsers.find(
        (u: any) => String(u.userId || u.user_id || '') === targetUserId || u.uid === uid
      );

      const deviceUserId = matchingDeviceUser
        ? String((matchingDeviceUser as any).userId || (matchingDeviceUser as any).user_id || targetUserId)
        : targetUserId;

      for (let fid = 0; fid < 10; fid++) {
        try {
          await zk.deleteFinger(deviceUserId, fid);
          deletedCount++;
        } catch {
          // No template at this finger index
        }
      }
      this.logger.log(`Withdrawn ${deletedCount}/10 fingerprint templates for "${person.name}" from ${deviceIp}`);
    } catch (err) {
      this.logger.warn(`Failed to delete templates for "${person.name}" from ${deviceIp}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
    }

    try {
      await zk.disconnect();
    } catch {
      // Ignore
    }

    await this.prisma.accessPerson.update({
      where: { id: personId },
      data: {
        fingerprintStatus: 'not_pushed',
        lastSyncAt: new Date(),
      },
    });

    const totalProcessed = Math.max(pullCount, deletedCount);

    return {
      success: true,
      message: totalProcessed > 0
        ? `تم سحب ${totalProcessed} بصمة لـ «${person.name}» من الجهاز`
        : `تم السحب (لم يتم العثور على بصمات لـ «${person.name}» على الجهاز)`,
    };
  }

  async storeFingerprintTemplateFromMigration(
    personId: string,
    zktecoUserId: number,
    fingerIndex: number,
    templateBase64: string,
    zktecoTemplateId?: number,
  ): Promise<{ created: boolean }> {
    const templateHash = this.hashTemplate(templateBase64);
    const templateSize = Buffer.from(templateBase64, 'base64').length;

    try {
      await this.prisma.fingerprintTemplate.upsert({
        where: { personId_fingerIndex: { personId, fingerIndex } },
        create: {
          personId,
          zktecoUserId,
          fingerIndex,
          valid: 1,
          templateData: templateBase64,
          templateSize,
          templateHash,
          zktecoTemplateId,
          source: 'migration',
        },
        update: {
          templateData: templateBase64,
          templateSize,
          templateHash,
          valid: 1,
        },
      });
      return { created: true };
    } catch (err) {
      this.logger.warn(`Failed to store fingerprint template for person ${personId} finger ${fingerIndex}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      return { created: false };
    }
  }

  async storeFaceTemplateFromMigration(
    personId: string,
    zktecoUserId: number,
    faceIndex: number,
    templateBase64: string,
    templateSize?: number,
    zktecoTemplateId?: number,
    valid: number = 1,
  ): Promise<{ created: boolean }> {
    const templateHash = this.hashTemplate(templateBase64);
    const size = templateSize || Buffer.from(templateBase64, 'base64').length;

    try {
      await this.prisma.faceTemplate.upsert({
        where: { personId_faceIndex: { personId, faceIndex } },
        create: {
          personId,
          zktecoUserId,
          faceIndex,
          valid,
          templateData: templateBase64,
          templateSize: size,
          templateHash,
          zktecoTemplateId,
          source: 'migration',
        },
        update: {
          templateData: templateBase64,
          templateSize: size,
          templateHash,
          valid,
        },
      });
      return { created: true };
    } catch (err) {
      this.logger.warn(`Failed to store face template for person ${personId} face ${faceIndex}: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      return { created: false };
    }
  }

  async getPersonBiometricSummary(personId: string): Promise<{
    fingerprintCount: number;
    faceCount: number;
    fingerprintStatus: string;
    faceStatus: string;
    fingers: { fingerIndex: number; valid: number; hasData: boolean }[];
    faces: { faceIndex: number; valid: number; hasData: boolean }[];
  }> {
    const person = await this.prisma.accessPerson.findUnique({
      where: { id: personId },
      select: { fingerprintStatus: true, faceStatus: true },
    });
    if (!person) throw new Error('Person not found');

    const fingerprintTemplates = await this.prisma.fingerprintTemplate.findMany({
      where: { personId },
      orderBy: { fingerIndex: 'asc' },
    });

    const faceTemplates = await this.prisma.faceTemplate.findMany({
      where: { personId },
      orderBy: { faceIndex: 'asc' },
    });

    return {
      fingerprintCount: fingerprintTemplates.length,
      faceCount: faceTemplates.length,
      fingerprintStatus: person.fingerprintStatus,
      faceStatus: person.faceStatus,
      fingers: fingerprintTemplates.map(t => ({
        fingerIndex: t.fingerIndex,
        valid: t.valid,
        hasData: t.templateData.length > 0,
      })),
      faces: faceTemplates.map(t => ({
        faceIndex: t.faceIndex,
        valid: t.valid,
        hasData: t.templateData.length > 0,
      })),
    };
  }
}
