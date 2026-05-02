import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceOverviewController } from './maintenance-overview.controller';
import { MaintenanceService } from './maintenance.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MaintenanceController, MaintenanceOverviewController],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
