import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { LinksModule } from './links/links.module';
import { PrismaModule } from './prisma.module';

@Module({
  imports: [PrismaModule, LinksModule, AdminModule],
})
export class AppModule {}
