import { Module } from '@nestjs/common';
import { FingerprintsController } from './fingerprints.controller';
import { FingerprintsService } from './fingerprints.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FingerprintsController],
  providers: [FingerprintsService],
})
export class FingerprintsModule {}
