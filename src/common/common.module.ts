import { Global, Module } from '@nestjs/common';
import { PersonSearchService } from './person-search.service';
import { PermissionsGuard } from './permissions/permissions.guard';
import { PrismaModule } from '../prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [PersonSearchService, PermissionsGuard],
  exports: [PersonSearchService, PermissionsGuard],
})
export class CommonModule {}
