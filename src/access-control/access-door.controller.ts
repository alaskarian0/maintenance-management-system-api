import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { AccessDoorService } from './access-door.service';
import { AccessSyncScheduler } from './access-sync.scheduler';
import { CreateDoorDto } from './dto/create-door.dto';
import { UpdateDoorDto } from './dto/update-door.dto';

@Controller('access-control/doors')
export class AccessDoorController {
  constructor(
    private readonly doorService: AccessDoorService,
    private readonly syncScheduler: AccessSyncScheduler,
  ) {}

  @Get('system-status')
  systemStatus() {
    return this.syncScheduler.status;
  }

  @Get()
  findAll() {
    return this.doorService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.doorService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDoorDto) {
    return this.doorService.create(dto);
  }

  @Post('sync')
  async syncDevices() {
    return this.doorService.pingAllDoors();
  }

  @Post('discover/:id')
  discoverInfo(@Param('id') id: string) {
    return this.doorService.discoverDeviceInfo(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDoorDto) {
    return this.doorService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.doorService.remove(id);
  }

  @Get(':id/persons')
  getDoorPersons(@Param('id') id: string) {
    return this.doorService.getDoorPersons(id);
  }

  @Post('ping')
  pingAll() {
    return this.doorService.pingAllDoors();
  }

  @Post(':id/ping')
  pingDoor(@Param('id') id: string) {
    return this.doorService.pingDoor(id);
  }
}
