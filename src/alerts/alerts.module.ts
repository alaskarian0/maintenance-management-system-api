import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { SparePartsModule } from '../spare-parts/spare-parts.module';

@Module({
  imports: [PrismaModule, AccessControlModule, SparePartsModule],
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
