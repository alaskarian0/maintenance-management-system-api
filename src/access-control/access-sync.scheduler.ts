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
      pendingOperations: 0,
    };
  }

  @Cron('*/30 * * * * *')
  async pingAllDevices() {
    const doors = await this.prisma.accessDoor.findMany();

    for (const door of doors) {
      if (!door.ipAddress) continue;

      try {
        const result = await this.fallback.pingDevice(door.ipAddress);
        const newState = result.reachable ? 1 : 3;

        if (door.state !== newState) {
          await this.prisma.accessDoor.update({
            where: { id: door.id },
            data: {
              state: newState,
              ...(result.reachable ? { lastActivity: new Date() } : {}),
            },
          });
          this.logger.log(
            `Device "${door.name}" state changed: ${door.state} -> ${newState}`,
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
    } catch (err) {
      this.logger.error(`Auto-sync error: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.isRunning = false;
    }
  }
}
