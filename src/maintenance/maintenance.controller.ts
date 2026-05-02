import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { CreateMaintenanceRecordDto } from './dto/create-maintenance-record.dto';
import { UpdateMaintenanceRecordDto } from './dto/update-maintenance-record.dto';

@Controller('devices/:deviceId/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get()
  findAll(@Param('deviceId') deviceId: string) {
    return this.maintenanceService.findAll(deviceId);
  }

  @Post()
  create(
    @Param('deviceId') deviceId: string,
    @Body() dto: CreateMaintenanceRecordDto,
  ) {
    return this.maintenanceService.create(deviceId, dto);
  }

  @Patch(':recordId')
  update(
    @Param('deviceId') deviceId: string,
    @Param('recordId') recordId: string,
    @Body() dto: UpdateMaintenanceRecordDto,
  ) {
    return this.maintenanceService.update(deviceId, recordId, dto);
  }

  @Delete(':recordId')
  remove(
    @Param('deviceId') deviceId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.maintenanceService.remove(deviceId, recordId);
  }
}
