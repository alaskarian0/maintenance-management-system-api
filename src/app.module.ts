import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { LinksModule } from './links/links.module';
import { PrismaModule } from './prisma.module';
import { DepartmentsModule } from './departments/departments.module';
import { CategoriesModule } from './categories/categories.module';
import { DevicesModule } from './devices/devices.module';
import { MaintenanceModule } from './maintenance/maintenance.module';

@Module({
  imports: [
    PrismaModule,
    LinksModule,
    AdminModule,
    DepartmentsModule,
    CategoriesModule,
    DevicesModule,
    MaintenanceModule,
  ],
})
export class AppModule {}
