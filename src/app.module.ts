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
import { FingerprintsModule } from './fingerprints/fingerprints.module';
import { ReportsModule } from './reports/reports.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MaintenanceRequestsModule } from './maintenance-requests/maintenance-requests.module';
import { SparePartsModule } from './spare-parts/spare-parts.module';
import { SearchModule } from './search/search.module';
import { AccessControlModule } from './access-control/access-control.module';

@Module({
  imports: [
    PrismaModule,
    ActivityLogModule,
    NotificationsModule,
    LinksModule,
    AdminModule,
    AuthModule,
    DepartmentsModule,
    CategoriesModule,
    SparePartsModule,
    DevicesModule,
    MaintenanceModule,
    MaintenanceRequestsModule,
    DashboardModule,
    UsersModule,
    FingerprintsModule,
    ReportsModule,
    SearchModule,
    AccessControlModule,
  ],
})
export class AppModule {}
