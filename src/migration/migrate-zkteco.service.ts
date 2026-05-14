import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import { MongoClient, Db } from 'mongodb';
import { createHash } from 'crypto';

interface MigrationResult {
  phase: string;
  total: number;
  created: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

@Injectable()
export class MigrateZktecoService {
  private readonly logger = new Logger(MigrateZktecoService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private async getMongoDb(): Promise<Db> {
    const uri = this.config.get('MONGODB_URI', 'mongodb://localhost:27017');
    const dbName = this.config.get('MONGODB_DB', 'zkteco_fingerprint_backup');
    const client = new MongoClient(uri);
    await client.connect();
    return client.db(dbName);
  }

  async runAll(): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];

    this.logger.log('=== Starting ZKTeco Migration ===');

    const r1 = await this.migrateShiftClasses();
    results.push(r1);

    const r2 = await this.migrateAccessPersons();
    results.push(r2);

    const r3 = await this.migrateFingerprintTemplates();
    results.push(r3);

    const r4 = await this.migrateFaceTemplates();
    results.push(r4);

    const r5 = await this.migrateUserTempSchedules();
    results.push(r5);

    const r6 = await this.migrateAccessLogs();
    results.push(r6);

    this.logger.log('=== ZKTeco Migration Complete ===');
    for (const r of results) {
      this.logger.log(`${r.phase}: ${r.created}/${r.total} created, ${r.skipped} skipped, ${r.errors} errors (${r.durationMs}ms)`);
    }

    return results;
  }

  async migrateShiftClasses(): Promise<MigrationResult> {
    const start = Date.now();
    this.logger.log('Phase 1: Migrating ShiftClasses...');

    const db = await this.getMongoDb();
    const collection = db.collection('SchClass');
    const records = await collection.find({}).toArray();
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const rec of records) {
      try {
        await this.prisma.shiftClass.upsert({
          where: { zktecoSchClassId: rec.schClassid },
          create: {
            zktecoSchClassId: rec.schClassid,
            name: rec.schName || `Shift ${rec.schClassid}`,
            startTime: this.parseZkTime(rec.StartTime),
            endTime: this.parseZkTime(rec.EndTime),
            lateMinutes: rec.LateMinutes ?? 0,
            earlyMinutes: rec.EarlyMinutes ?? 0,
            checkIn: rec.CheckIn === 1,
            checkOut: rec.CheckOut === 1,
            workDay: rec.WorkDay ?? 1.0,
            color: rec.Color ?? 0,
          },
          update: {
            name: rec.schName || `Shift ${rec.schClassid}`,
            startTime: this.parseZkTime(rec.StartTime),
            endTime: this.parseZkTime(rec.EndTime),
            lateMinutes: rec.LateMinutes ?? 0,
            earlyMinutes: rec.EarlyMinutes ?? 0,
            checkIn: rec.CheckIn === 1,
            checkOut: rec.CheckOut === 1,
            workDay: rec.WorkDay ?? 1.0,
            color: rec.Color ?? 0,
          },
        });
        created++;
      } catch (err) {
        errors++;
        this.logger.warn(`Failed to migrate SchClass ${rec.schClassid}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { phase: 'ShiftClasses', total: records.length, created, skipped, errors, durationMs: Date.now() - start };
  }

  async migrateAccessPersons(): Promise<MigrationResult> {
    const start = Date.now();
    this.logger.log('Phase 2: Migrating AccessPersons...');

    const db = await this.getMongoDb();
    const collection = db.collection('USERINFO');
    const total = await collection.countDocuments();
    let created = 0;
    let skipped = 0;
    let errors = 0;

    const BATCH_SIZE = 500;
    const cursor = collection.find({}).batchSize(BATCH_SIZE);

    let batch: any[] = [];
    for await (const rec of cursor) {
      batch.push(rec);
      if (batch.length >= BATCH_SIZE) {
        const result = await this.processPersonBatch(batch);
        created += result.created;
        skipped += result.skipped;
        errors += result.errors;
        batch = [];
        this.logger.log(`  Progress: ${created + skipped + errors}/${total} persons`);
      }
    }

    if (batch.length > 0) {
      const result = await this.processPersonBatch(batch);
      created += result.created;
      skipped += result.skipped;
      errors += result.errors;
    }

    return { phase: 'AccessPersons', total, created, skipped, errors, durationMs: Date.now() - start };
  }

  private async processPersonBatch(records: any[]): Promise<{ created: number; skipped: number; errors: number }> {
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const rec of records) {
      try {
        const existing = await this.prisma.accessPerson.findFirst({
          where: {
            OR: [
              { personId: rec.USERID },
              { empCode: rec.Badgenumber ? String(rec.Badgenumber) : undefined },
            ].filter(Boolean),
          },
        });

        if (existing) {
          skipped++;
          continue;
        }

        const isTemporary = rec.Expires === 1 && rec.ValidTimeEnd;
        const accessEndDate = rec.ValidTimeEnd ? new Date(rec.ValidTimeEnd) : null;
        const isExpired = accessEndDate && accessEndDate < new Date();

        await this.prisma.accessPerson.create({
          data: {
            personType: (rec.Gender === 'Female' || rec.Gender === 'F') ? 'RESIDENT' : 'EMPLOYEE',
            name: rec.Name || `User ${rec.USERID}`,
            personId: rec.USERID,
            empCode: rec.Badgenumber ? String(rec.Badgenumber) : null,
            zkEmployeeId: rec.USERID,
            region: rec.STATE || null,
            note: rec.Notes === '[BLOB]' ? null : rec.Notes || null,
            phone: rec.OPHONE || rec.FPHONE || null,
            accessType: isTemporary ? 'temporary' : 'permanent',
            accessEndDate: isTemporary ? accessEndDate : null,
            isActive: isTemporary && isExpired ? false : true,
            birthDate: rec.BIRTHDAY ? new Date(rec.BIRTHDAY) : null,
            hireDate: rec.HIREDDAY ? new Date(rec.HIREDDAY) : null,
            address: rec.street || rec.TITLE || null,
            role: rec.privilege === 3 ? 'admin' : 'user',
            fingerprintStatus: 'none',
            faceStatus: 'none',
          },
        });
        created++;
      } catch (err) {
        errors++;
        this.logger.warn(`Failed to migrate USERINFO ${rec.USERID}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { created, skipped, errors };
  }

  async migrateFingerprintTemplates(): Promise<MigrationResult> {
    const start = Date.now();
    this.logger.log('Phase 3: Migrating FingerprintTemplates...');

    const db = await this.getMongoDb();
    const collection = db.collection('TEMPLATE');
    const total = await collection.countDocuments({ TEMPLATE: { $ne: '[BLOB]' } });
    let created = 0;
    let skipped = 0;
    let errors = 0;

    this.logger.log(`  Note: ${await collection.countDocuments({ TEMPLATE: '[BLOB]' })} templates have [BLOB] placeholders and cannot be migrated as binary data.`);
    this.logger.log(`  Fingerprint template binary data was extracted separately to output/images/fingerprints/ during the initial migration.`);

    const cursor = collection.find({}).batchSize(500);
    for await (const rec of cursor) {
      try {
        const person = await this.prisma.accessPerson.findFirst({
          where: { personId: rec.USERID },
        });

        if (!person) {
          skipped++;
          continue;
        }

        if (rec.TEMPLATE === '[BLOB]') {
          skipped++;
          continue;
        }

        const templateBase64 = Buffer.isBuffer(rec.TEMPLATE)
          ? rec.TEMPLATE.toString('base64')
          : typeof rec.TEMPLATE === 'string' && rec.TEMPLATE !== '[BLOB]'
            ? rec.TEMPLATE
            : null;

        if (!templateBase64) {
          skipped++;
          continue;
        }

        const templateHash = createHash('sha256').update(Buffer.from(templateBase64, 'base64')).digest('hex');

        await this.prisma.fingerprintTemplate.upsert({
          where: { personId_fingerIndex: { personId: person.id, fingerIndex: rec.FINGERID } },
          create: {
            personId: person.id,
            zktecoUserId: rec.USERID,
            fingerIndex: rec.FINGERID,
            valid: rec.USETYPE ?? 1,
            templateData: templateBase64,
            templateSize: templateBase64.length,
            templateHash,
            zktecoTemplateId: rec.TEMPLATEID,
            source: 'migration',
          },
          update: {
            templateData: templateBase64,
            templateHash,
          },
        });
        created++;
      } catch (err) {
        errors++;
        if (errors <= 5) {
          this.logger.warn(`Failed to migrate TEMPLATE ${rec.TEMPLATEID}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (created > 0) {
      await this.prisma.accessPerson.updateMany({
        where: { fingerprintStatus: 'none' },
        data: { fingerprintStatus: 'migrated' },
      });
    }

    return { phase: 'FingerprintTemplates', total: total + skipped, created, skipped, errors, durationMs: Date.now() - start };
  }

  async migrateFaceTemplates(): Promise<MigrationResult> {
    const start = Date.now();
    this.logger.log('Phase 4: Migrating FaceTemplates...');

    const db = await this.getMongoDb();
    const collection = db.collection('FaceTemp');
    const total = await collection.countDocuments();
    let created = 0;
    let skipped = 0;
    let errors = 0;

    const blobCount = await collection.countDocuments({ TEMPLATE: '[BLOB]' });
    this.logger.log(`  Note: ${blobCount} face templates have [BLOB] placeholders.`);
    this.logger.log(`  Face template binary data was extracted separately to output/images/faces/ during the initial migration.`);

    const cursor = collection.find({}).batchSize(500);
    for await (const rec of cursor) {
      try {
        const person = await this.prisma.accessPerson.findFirst({
          where: { personId: rec.UserID },
        });

        if (!person) {
          skipped++;
          continue;
        }

        if (rec.TEMPLATE === '[BLOB]') {
          skipped++;
          continue;
        }

        const templateBase64 = Buffer.isBuffer(rec.TEMPLATE)
          ? rec.TEMPLATE.toString('base64')
          : typeof rec.TEMPLATE === 'string' && rec.TEMPLATE !== '[BLOB]'
            ? rec.TEMPLATE
            : null;

        if (!templateBase64) {
          skipped++;
          continue;
        }

        const templateHash = createHash('sha256').update(Buffer.from(templateBase64, 'base64')).digest('hex');

        await this.prisma.faceTemplate.upsert({
          where: { personId_faceIndex: { personId: person.id, faceIndex: rec.FACEID ?? 0 } },
          create: {
            personId: person.id,
            zktecoUserId: rec.UserID,
            faceIndex: rec.FACEID ?? 0,
            valid: rec.VALID ?? 1,
            templateData: templateBase64,
            templateSize: rec.SIZE ?? Buffer.from(templateBase64, 'base64').length,
            templateHash,
            zktecoTemplateId: rec.TEMPLATEID,
            source: 'migration',
          },
          update: {
            templateData: templateBase64,
            templateHash,
          },
        });
        created++;
      } catch (err) {
        errors++;
        if (errors <= 5) {
          this.logger.warn(`Failed to migrate FaceTemp ${rec.TEMPLATEID}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (created > 0) {
      await this.prisma.accessPerson.updateMany({
        where: { faceStatus: 'none' },
        data: { faceStatus: 'migrated' },
      });
    }

    return { phase: 'FaceTemplates', total, created, skipped, errors, durationMs: Date.now() - start };
  }

  async migrateUserTempSchedules(): Promise<MigrationResult> {
    const start = Date.now();
    this.logger.log('Phase 5: Migrating UserTempSchedules...');

    const db = await this.getMongoDb();
    const collection = db.collection('USER_TEMP_SCH');
    const total = await collection.countDocuments();
    let created = 0;
    let skipped = 0;
    let errors = 0;

    const BATCH_SIZE = 500;
    const cursor = collection.find({}).batchSize(BATCH_SIZE);
    let batchData: any[] = [];

    for await (const rec of cursor) {
      try {
        const person = await this.prisma.accessPerson.findFirst({
          where: { personId: rec.USERID },
        });

        if (!person) {
          skipped++;
          continue;
        }

        let shiftClassId: string | null = null;
        if (rec.SCHCLASSID) {
          const shiftClass = await this.prisma.shiftClass.findUnique({
            where: { zktecoSchClassId: rec.SCHCLASSID },
          });
          shiftClassId = shiftClass?.id ?? null;
        }

        batchData.push({
          personId: person.id,
          shiftClassId,
          comeTime: rec.COMETIME ? new Date(rec.COMETIME) : new Date(),
          leaveTime: rec.LEAVETIME ? new Date(rec.LEAVETIME) : new Date(),
          scheduleType: rec.TYPE ?? 0,
          flag: rec.FLAG ?? 1,
          overtime: rec.OVERTIME === 1,
          zktecoSchClassId: rec.SCHCLASSID ?? null,
        });

        if (batchData.length >= BATCH_SIZE) {
          try {
            const result = await this.prisma.userTempSchedule.createMany({ data: batchData });
            created += result.count;
          } catch (err) {
            errors += batchData.length;
            this.logger.warn(`Batch insert failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          batchData = [];
          this.logger.log(`  Progress: ${created + skipped + errors}/${total} schedules`);
        }
      } catch (err) {
        errors++;
        if (errors <= 5) {
          this.logger.warn(`Failed to process USER_TEMP_SCH for USERID ${rec.USERID}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (batchData.length > 0) {
      try {
        const result = await this.prisma.userTempSchedule.createMany({ data: batchData });
        created += result.count;
      } catch (err) {
        errors += batchData.length;
        this.logger.warn(`Final batch insert failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { phase: 'UserTempSchedules', total, created, skipped, errors, durationMs: Date.now() - start };
  }

  async migrateAccessLogs(): Promise<MigrationResult> {
    const start = Date.now();
    this.logger.log('Phase 6: Migrating AccessLogs...');

    const db = await this.getMongoDb();
    const collection = db.collection('CHECKINOUT');
    const total = await collection.countDocuments();
    let created = 0;
    let skipped = 0;
    let errors = 0;

    const BATCH_SIZE = 500;
    const cursor = collection.find({}).sort({ CHECKTIME: 1 }).batchSize(BATCH_SIZE);
    let batchData: any[] = [];

    // Get all doors for matching by serial number
    const doors = await this.prisma.accessDoor.findMany({ include: { devices: true } });
    const deviceSerialMap = new Map<string, string>();
    for (const door of doors) {
      for (const device of door.devices) {
        if (device.serialNumber) {
          deviceSerialMap.set(device.serialNumber, door.id);
        }
      }
    }

    // If no doors exist, create a default one for migrated logs
    let defaultDoorId: string | null = null;
    if (doors.length === 0) {
      const defaultDoor = await this.prisma.accessDoor.create({
        data: { name: 'مهاجر من ZKTeco', location: 'Auto-created for migration' },
      });
      defaultDoorId = defaultDoor.id;
      this.logger.log(`Created default door for migrated logs: ${defaultDoor.id}`);
    } else {
      defaultDoorId = doors[0].id;
    }

    for await (const rec of cursor) {
      try {
        const person = await this.prisma.accessPerson.findFirst({
          where: { personId: rec.USERID },
        });

        if (!person) {
          skipped++;
          continue;
        }

        const doorId = (rec.sn && deviceSerialMap.get(rec.sn)) || defaultDoorId;
        if (!doorId) {
          skipped++;
          continue;
        }

        const verifyType = rec.VERIFYCODE ?? 0;
        const punchState = rec.CHECKTYPE === 'I' || rec.CHECKTYPE === 'i' ? 0 : 1;
        const punchTime = rec.CHECKTIME ? new Date(rec.CHECKTIME) : new Date();

        batchData.push({
          personId: person.id,
          doorId,
          punchTime,
          punchState,
          verifyType,
          status: 'authorized',
          syncedFromZKBio: true,
        });

        if (batchData.length >= BATCH_SIZE) {
          try {
            const result = await this.prisma.accessLog.createMany({ data: batchData, skipDuplicates: true });
            created += result.count;
          } catch (err) {
            errors += batchData.length;
            if (errors <= 20) {
              this.logger.warn(`Log batch insert failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          batchData = [];
          this.logger.log(`  Progress: ${created + skipped + errors}/${total} logs`);
        }
      } catch (err) {
        errors++;
        if (errors <= 5) {
          this.logger.warn(`Failed to process CHECKINOUT for USERID ${rec.USERID}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (batchData.length > 0) {
      try {
        const result = await this.prisma.accessLog.createMany({ data: batchData, skipDuplicates: true });
        created += result.count;
      } catch (err) {
        errors += batchData.length;
        this.logger.warn(`Final log batch insert failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { phase: 'AccessLogs', total, created, skipped, errors, durationMs: Date.now() - start };
  }

  private parseZkTime(value: any): Date {
    if (!value) return new Date('1899-12-30T00:00:00Z');
    if (value instanceof Date) return value;
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date('1899-12-30T00:00:00Z') : d;
  }

  async getStatus(): Promise<{
    persons: number;
    fingerprintTemplates: number;
    faceTemplates: number;
    shiftClasses: number;
    tempSchedules: number;
    accessLogs: number;
  }> {
    const [
      persons,
      fingerprintTemplates,
      faceTemplates,
      shiftClasses,
      tempSchedules,
      accessLogs,
    ] = await Promise.all([
      this.prisma.accessPerson.count(),
      this.prisma.fingerprintTemplate.count(),
      this.prisma.faceTemplate.count(),
      this.prisma.shiftClass.count(),
      this.prisma.userTempSchedule.count(),
      this.prisma.accessLog.count(),
    ]);

    return { persons, fingerprintTemplates, faceTemplates, shiftClasses, tempSchedules, accessLogs };
  }
}
