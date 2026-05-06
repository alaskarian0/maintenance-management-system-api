import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { MaintenanceStatus } from '@prisma/client';
import { MaintenanceService } from './maintenance.service';
import { BulkMaintenanceStatusDto } from './dto/bulk-maintenance-status.dto';

/** Cross-device maintenance listing (not nested under /devices/:id) */
@Controller('maintenance')
export class MaintenanceOverviewController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get('recent')
  findRecent(
    @Query('limit') limit?: string,
    @Query('status') status?: MaintenanceStatus,
    @Query('technicianName') technicianName?: string,
    @Query('departmentId') departmentId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const parsed = parseInt(limit ?? '80', 10);
    const n = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 200)
      : 80;
    return this.maintenanceService.findRecent(n, {
      status,
      technicianName,
      departmentId,
      dateFrom,
      dateTo,
    });
  }

  @Patch('bulk-status')
  bulkStatus(@Body() body: BulkMaintenanceStatusDto) {
    return this.maintenanceService.bulkUpdateStatus(body.ids, body.status);
  }
}
