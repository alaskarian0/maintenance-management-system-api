import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  global(@Query('q') q?: string) {
    return this.searchService.global(q ?? '');
  }
}
