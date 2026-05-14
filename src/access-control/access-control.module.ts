import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AccessFallbackService } from './access-fallback.service';
import { AccessDoorController } from './access-door.controller';
import { AccessDoorService } from './access-door.service';
import { AccessPersonController } from './access-person.controller';
import { AccessPersonService } from './access-person.service';
import { AccessDeviceSyncService } from './access-device-sync.service';
import { AccessPermissionController } from './access-permission.controller';
import { AccessPermissionService } from './access-permission.service';
import { AccessLogController } from './access-log.controller';
import { AccessLogService } from './access-log.service';
import { AccessSyncScheduler } from './access-sync.scheduler';
import { AccessBiometricService } from './access-biometric.service';
import { ShiftClassService } from './shift-class.service';
import { ShiftClassController } from './shift-class.controller';
import { UserTempScheduleService } from './user-temp-schedule.service';
import { UserTempScheduleController } from './user-temp-schedule.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    AccessDoorController,
    AccessPersonController,
    AccessPermissionController,
    AccessLogController,
    ShiftClassController,
    UserTempScheduleController,
  ],
  providers: [
    AccessFallbackService,
    AccessDoorService,
    AccessPersonService,
    AccessDeviceSyncService,
    AccessPermissionService,
    AccessLogService,
    AccessSyncScheduler,
    AccessBiometricService,
    ShiftClassService,
    UserTempScheduleService,
  ],
  exports: [AccessLogService, AccessDeviceSyncService, ShiftClassService, UserTempScheduleService],
})
export class AccessControlModule {}
