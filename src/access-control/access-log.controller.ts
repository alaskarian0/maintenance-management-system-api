import { Controller, Get, Post, Query } from '@nestjs/common';
import { AccessLogService } from './access-log.service';

@Controller('access-control/logs')
export class AccessLogController {
  constructor(private readonly logService: AccessLogService) {}

  @Get()
  findAll(
    @Query('doorId') doorId?: string,
    @Query('personId') personId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.logService.findAll({
      doorId,
      personId,
      dateFrom,
      dateTo,
      status,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: Math.min(pageSize ? parseInt(pageSize, 10) : 50, 500),
    });
  }

  @Get('today')
  getToday() {
    return this.logService.getToday();
  }

  @Post('sync')
  syncFromDevices() {
    return this.logService.syncAllDevices();
  }

  @Get('stats')
  getStats() {
    return this.logService.getStats();
  }
}
