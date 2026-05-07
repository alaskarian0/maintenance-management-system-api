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
import { ZKBioClient } from './zkbio.client';
import { CreateDoorDto } from './dto/create-door.dto';
import { UpdateDoorDto } from './dto/update-door.dto';

@Controller('access-control/doors')
export class AccessDoorController {
  constructor(
    private readonly doorService: AccessDoorService,
    private readonly zkBio: ZKBioClient,
  ) {}

  @Get('server-status')
  checkServerStatus() {
    return this.zkBio.healthCheck();
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
  syncFromZKBio() {
    return this.doorService.syncFromZKBio();
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
}
