import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Headers,
} from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { CreateMaintenanceRecordDto } from './dto/create-maintenance-record.dto';
import { UpdateMaintenanceRecordDto } from './dto/update-maintenance-record.dto';

@Controller('devices/items/:itemId/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  private actor(h?: string) {
    return (h && h.trim()) || 'غير معروف';
  }

  @Get()
  findAll(@Param('itemId') itemId: string) {
    return this.maintenanceService.findAll(itemId);
  }

  @Post()
  create(
    @Param('itemId') itemId: string,
    @Body() dto: CreateMaintenanceRecordDto,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.maintenanceService.create(itemId, dto, this.actor(userName));
  }

  @Patch(':recordId')
  update(
    @Param('itemId') itemId: string,
    @Param('recordId') recordId: string,
    @Body() dto: UpdateMaintenanceRecordDto,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.maintenanceService.update(
      itemId,
      recordId,
      dto,
      this.actor(userName),
    );
  }

  @Delete(':recordId')
  remove(
    @Param('itemId') itemId: string,
    @Param('recordId') recordId: string,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.maintenanceService.remove(
      itemId,
      recordId,
      this.actor(userName),
    );
  }
}
