import { Module } from '@nestjs/common';
import { AdminLettersController } from './admin-letters.controller';
import { AdminLettersService } from './admin-letters.service';

@Module({
  controllers: [AdminLettersController],
  providers: [AdminLettersService],
})
export class AdminLettersModule {}
