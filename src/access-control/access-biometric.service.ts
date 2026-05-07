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
      this.logger.warn(`Cannot connect to ${deviceIp} for template pull: ${err instanceof Error ? err.message : err}`);
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
      this.logger.warn(`Failed to pull templates from ${deviceIp}: ${err instanceof Error ? err.message : err}`);
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
      this.logger.warn(`Cannot connect to ${deviceIp} for template restore: ${err instanceof Error ? err.message : err}`);
      return { fingers: 0, face: false };
    }

    let restoredFingers = 0;
    let restoredFace = false;

    const userId = String(person.empCode || person.personId || '');

    // Upload fingerprint templates
    if (stored.fingers?.length) {
      for (const finger of stored.fingers) {
        try {
          const templateBuffer = Buffer.from(finger.template_base64, 'base64');
          const templateBase64 = templateBuffer.toString('base64');

          await zk.uploadFingerTemplate(userId, templateBase64, finger.fid, finger.valid);
          restoredFingers++;
        } catch (err) {
          this.logger.warn(`Failed to upload finger ${finger.fid} to ${deviceIp}: ${err instanceof Error ? err.message : err}`);
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
    return (person?.fingerprintTemplates as unknown as StoredTemplates) || null;
  }
}
