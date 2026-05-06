import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('device-inventory')
  deviceInventory(
    @Query('status') status?: string,
    @Query('departmentId') departmentId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('deviceTypeId') deviceTypeId?: string,
    @Query('search') search?: string,
  ) {
    return this.reportsService.deviceInventory({
      status,
      departmentId,
      categoryId,
      deviceTypeId,
      search,
    });
  }

  @Get('maintenance-history')
  maintenanceHistory(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('departmentId') departmentId?: string,
    @Query('technicianName') technicianName?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.reportsService.maintenanceHistory({
      dateFrom,
      dateTo,
      departmentId,
      technicianName,
      status,
      search,
    });
  }

  @Get('device-transfers')
  deviceTransfers(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('departmentId') departmentId?: string,
    @Query('search') search?: string,
  ) {
    return this.reportsService.deviceTransfers({
      dateFrom,
      dateTo,
      departmentId,
      search,
    });
  }
}
