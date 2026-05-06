import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceOverviewController } from './maintenance-overview.controller';
import { MaintenanceService } from './maintenance.service';
import { PrismaModule } from '../prisma.module';
import { SparePartsModule } from '../spare-parts/spare-parts.module';

@Module({
  imports: [PrismaModule, SparePartsModule],
  controllers: [MaintenanceController, MaintenanceOverviewController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
