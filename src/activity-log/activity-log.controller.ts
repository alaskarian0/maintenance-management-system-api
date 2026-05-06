import { Controller, Get, Query } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';

@Controller('activity-log')
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  @Get()
  findAll(
    @Query('entity') entity?: string,
    @Query('action') action?: string,
    @Query('userName') userName?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.activityLogService.findAll({
      entity,
      action,
      userName,
      dateFrom,
      dateTo,
      page,
      limit,
    });
  }
}
