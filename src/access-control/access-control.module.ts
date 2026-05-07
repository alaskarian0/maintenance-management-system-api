import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AccessFallbackService } from './access-fallback.service';
import { AccessDoorController } from './access-door.controller';
import { AccessDoorService } from './access-door.service';
import { AccessPersonController } from './access-person.controller';
import { AccessPersonService } from './access-person.service';
import { AccessPermissionController } from './access-permission.controller';
import { AccessPermissionService } from './access-permission.service';
import { AccessLogController } from './access-log.controller';
import { AccessLogService } from './access-log.service';
import { AccessSyncScheduler } from './access-sync.scheduler';
import { AccessBiometricService } from './access-biometric.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AccessDoorController,
    AccessPersonController,
    AccessPermissionController,
    AccessLogController,
  ],
  providers: [
    AccessFallbackService,
    AccessDoorService,
    AccessPersonService,
    AccessPermissionService,
    AccessLogService,
    AccessSyncScheduler,
    AccessBiometricService,
  ],
  exports: [AccessLogService],
})
export class AccessControlModule {}
