import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Headers,
} from '@nestjs/common';
import { MaintenanceRequestStatus } from '@prisma/client';
import { MaintenanceRequestsService } from './maintenance-requests.service';
import { CreateMaintenanceRequestDto } from './dto/create-maintenance-request.dto';
import { AssignMaintenanceRequestDto } from './dto/assign-maintenance-request.dto';
import { ApproveMaintenanceRequestDto } from './dto/approve-maintenance-request.dto';
import { RejectMaintenanceRequestDto } from './dto/reject-maintenance-request.dto';
import { ResolveMaintenanceRequestDto } from './dto/resolve-maintenance-request.dto';

@Controller('maintenance-requests')
export class MaintenanceRequestsController {
  constructor(
    private readonly maintenanceRequestsService: MaintenanceRequestsService,
  ) {}

  @Get()
  findAll(
    @Query('status') status?: MaintenanceRequestStatus,
    @Query('requestedBy') requestedBy?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('deviceItemId') deviceItemId?: string,
    @Headers('x-user-role') userRole?: string,
    @Headers('x-workshop-id') userWorkshopId?: string,
  ) {
    return this.maintenanceRequestsService.findAll({
      status,
      requestedBy,
      assignedTo,
      deviceItemId,
      userRole,
      userWorkshopId,
    });
  }

  @Post()
  create(@Body() dto: CreateMaintenanceRequestDto) {
    return this.maintenanceRequestsService.create(dto);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveMaintenanceRequestDto) {
    return this.maintenanceRequestsService.approve(id, dto);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectMaintenanceRequestDto) {
    return this.maintenanceRequestsService.reject(id, dto);
  }

  @Patch(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignMaintenanceRequestDto) {
    return this.maintenanceRequestsService.assign(id, dto);
  }

  @Patch(':id/resolve')
  resolve(@Param('id') id: string, @Body() dto: ResolveMaintenanceRequestDto) {
    return this.maintenanceRequestsService.resolve(id, dto);
  }
}
