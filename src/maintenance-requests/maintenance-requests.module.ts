import { Module } from '@nestjs/common';
import { MaintenanceRequestsService } from './maintenance-requests.service';
import { MaintenanceRequestsController } from './maintenance-requests.controller';
import { PrismaModule } from '../prisma.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';

@Module({
  imports: [PrismaModule, MaintenanceModule],
  controllers: [MaintenanceRequestsController],
  providers: [MaintenanceRequestsService],
})
export class MaintenanceRequestsModule {}
