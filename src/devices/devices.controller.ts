import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Headers,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { QueryDeviceDto } from './dto/query-device.dto';
import { AddItemsDto } from './dto/add-items.dto';
import { AssignItemDto } from './dto/assign-item.dto';
import { BulkImportDto } from './dto/bulk-import.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { UpdateDeviceItemDto } from './dto/update-device-item.dto';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  private actor(h?: string) {
    return (h && h.trim()) || 'غير معروف';
  }

  @Get()
  findAll(@Query() query: QueryDeviceDto) {
    return this.devicesService.findAll(query);
  }

  @Get('items')
  findAllItems() {
    return this.devicesService.findAllItems();
  }

  @Post('bulk-import')
  bulkImport(
    @Body() dto: BulkImportDto,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.devicesService.bulkImport(dto, this.actor(userName));
  }

  @Post('items/bulk-assign')
  bulkAssign(
    @Body() dto: BulkAssignDto,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.devicesService.bulkAssign(dto, this.actor(userName));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devicesService.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateDeviceDto,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.devicesService.create(dto, this.actor(userName));
  }

  @Post(':id/items')
  addItems(
    @Param('id') id: string,
    @Body() dto: AddItemsDto,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.devicesService.addItems(id, dto, this.actor(userName));
  }

  @Post('items/:itemId/assign')
  assignItem(
    @Param('itemId') itemId: string,
    @Body() dto: AssignItemDto,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.devicesService.assignItem(itemId, dto, this.actor(userName));
  }

  @Post('items/:itemId/return')
  returnItem(
    @Param('itemId') itemId: string,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.devicesService.returnItem(itemId, this.actor(userName));
  }

  @Patch('items/:itemId')
  updateDeviceItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateDeviceItemDto,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.devicesService.updateDeviceItem(
      itemId,
      dto,
      this.actor(userName),
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeviceDto,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.devicesService.update(id, dto, this.actor(userName));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.devicesService.remove(id, this.actor(userName));
  }

  @Delete('items/:itemId')
  removeItem(
    @Param('itemId') itemId: string,
    @Headers('x-user-name') userName?: string,
  ) {
    return this.devicesService.removeItem(itemId, this.actor(userName));
  }
}
