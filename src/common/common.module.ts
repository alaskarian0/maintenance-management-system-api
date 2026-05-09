import { Global, Module } from '@nestjs/common';
import { PersonSearchService } from './person-search.service';

@Global()
@Module({
  providers: [PersonSearchService],
  exports: [PersonSearchService],
})
export class CommonModule {}
