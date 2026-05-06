import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { PrismaModule } from '../prisma.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [PrismaModule, CategoriesModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
