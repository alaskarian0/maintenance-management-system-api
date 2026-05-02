import { Controller, Get, Query } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';

/** Cross-device maintenance listing (not nested under /devices/:id) */
@Controller('maintenance')
export class MaintenanceOverviewController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get('recent')
  findRecent(@Query('limit') limit?: string) {
    const parsed = parseInt(limit ?? '80', 10);
    const n = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 200)
      : 80;
    return this.maintenanceService.findRecent(n);
  }
}
