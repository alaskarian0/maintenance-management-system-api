import { Module } from '@nestjs/common';
import { WorkshopsService } from './workshops.service';
import { WorkshopsController } from './workshops.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [WorkshopsController],
  providers: [WorkshopsService, PrismaService],
  exports: [WorkshopsService],
})
export class WorkshopsModule {}
