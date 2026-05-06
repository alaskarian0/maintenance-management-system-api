import { Module } from '@nestjs/common';
import { SparePartsService } from './spare-parts.service';
import { SparePartsController } from './spare-parts.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SparePartsController],
  providers: [SparePartsService],
  exports: [SparePartsService],
})
export class SparePartsModule {}
