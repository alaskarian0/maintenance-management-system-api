import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthController } from './auth.controller';

@Module({
  imports: [AdminModule],
  controllers: [AuthController],
})
export class AuthModule {}
