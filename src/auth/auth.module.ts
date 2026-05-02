import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { PrismaModule } from '../prisma.module';
import { AuthController } from './auth.controller';

@Module({
  imports: [AdminModule, PrismaModule],
  controllers: [AuthController],
})
export class AuthModule {}
