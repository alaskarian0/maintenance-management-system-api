import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ZKBioClient } from './zkbio.client';
import { AccessDoorController } from './access-door.controller';
import { AccessDoorService } from './access-door.service';
import { AccessPersonController } from './access-person.controller';
import { AccessPersonService } from './access-person.service';
import { AccessPermissionController } from './access-permission.controller';
import { AccessPermissionService } from './access-permission.service';
import { AccessLogController } from './access-log.controller';
import { AccessLogService } from './access-log.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AccessDoorController,
    AccessPersonController,
    AccessPermissionController,
    AccessLogController,
  ],
  providers: [
    ZKBioClient,
    AccessDoorService,
    AccessPersonService,
    AccessPermissionService,
    AccessLogService,
  ],
  exports: [AccessLogService],
})
export class AccessControlModule {}
