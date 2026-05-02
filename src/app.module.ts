import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { LinksModule } from './links/links.module';
import { PrismaModule } from './prisma.module';
import { DepartmentsModule } from './departments/departments.module';
import { CategoriesModule } from './categories/categories.module';
import { DevicesModule } from './devices/devices.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    PrismaModule,
    LinksModule,
    AdminModule,
    AuthModule,
    DepartmentsModule,
    CategoriesModule,
    DevicesModule,
    MaintenanceModule,
    DashboardModule,
    UsersModule,
  ],
})
export class AppModule {}
