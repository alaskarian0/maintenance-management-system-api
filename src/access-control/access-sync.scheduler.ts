import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccessDoorService } from './access-door.service';
import { AccessLogService } from './access-log.service';
import { AccessPersonService } from './access-person.service';
import { AccessFallbackService } from './access-fallback.service';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AccessSyncScheduler {
  private readonly logger = new Logger(AccessSyncScheduler.name);
  private isRunning = false;

  constructor(
    private doorService: AccessDoorService,
    private logService: AccessLogService,
    private personService: AccessPersonService,
    private fallback: AccessFallbackService,
    private prisma: PrismaService,
  ) {}

  get status() {
    return {
      isRunning: this.isRunning,
    };
  }

  @Cron('*/30 * * * * *')
  async pingAllDevices() {
    const devices = await this.prisma.accessDevice.findMany();

    for (const device of devices) {
      if (!device.ipAddress) continue;

      try {
        const result = await this.fallback.pingDevice(device.ipAddress);
        const newState = result.reachable ? 1 : 3;

        if (device.state !== newState) {
          await this.prisma.accessDevice.update({
            where: { id: device.id },
            data: {
              state: newState,
              ...(result.reachable ? { lastActivity: new Date() } : {}),
            },
          });
          this.logger.log(
            `Device "${device.name}" state changed: ${device.state} -> ${newState}`,
          );
        }
      } catch {
        // Skip this device
      }
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async fullSync() {
    if (this.isRunning) {
      this.logger.debug('Sync already running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const results: Record<string, string> = {};

      // 1. Pull attendance logs from all online devices
      try {
        const logSync = await this.logService.syncAllDevices();
        const totalSynced = logSync.reduce((sum, r) => sum + r.synced, 0);
        const totalDevices = logSync.length;
        results['logs'] = `${totalSynced} synced from ${totalDevices} device(s)`;
      } catch (err) {
        results['logs'] = 'failed';
        this.logger.warn(`Log sync failed: ${err instanceof Error ? err.message : err}`);
      }

      const elapsed = Date.now() - startTime;
      this.logger.log(`Auto-sync completed (${elapsed}ms): ${JSON.stringify(results)}`);

      // 2. Retry pending device operations
      try {
        const retryResult = await this.personService.retryPendingOperations();
        if (retryResult.succeeded > 0 || retryResult.removed > 0) {
          this.logger.log(`Pending ops: ${retryResult.succeeded} succeeded, ${retryResult.removed} dropped`);
        }
      } catch (err) {
        this.logger.warn(`Pending ops retry failed: ${err instanceof Error ? err.message : err}`);
      }

      // 3. Clean up old completed operations (> 24 hours)
      try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const deleted = await this.prisma.pendingDeviceOp.deleteMany({
          where: {
            status: { in: ['success', 'failed'] },
            updatedAt: { lt: cutoff },
          },
        });
        if (deleted.count > 0) {
          this.logger.log(`Cleaned up ${deleted.count} old completed pending operations`);
        }
      } catch (err) {
        this.logger.warn(`Pending ops cleanup failed: ${err instanceof Error ? err.message : err}`);
      }

      // 4. Expire temporary access
      try {
        const expiryResult = await this.personService.expireTemporaryAccess();
        if (expiryResult.expired > 0) {
          this.logger.log(`Expired ${expiryResult.expired} temporary access persons`);
        }
      } catch (err) {
        this.logger.warn(`Temporary access expiry failed: ${err instanceof Error ? err.message : err}`);
      }
    } catch (err) {
      this.logger.error(`Auto-sync error: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.isRunning = false;
    }
  }
}
