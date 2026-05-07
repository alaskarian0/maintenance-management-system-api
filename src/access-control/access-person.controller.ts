import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { AccessPersonService } from './access-person.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { QueryPersonDto } from './dto/query-person.dto';

@Controller('access-control/persons')
export class AccessPersonController {
  constructor(private readonly personService: AccessPersonService) {}

  @Get()
  findAll(@Query() query: QueryPersonDto) {
    return this.personService.findAll(query);
  }

  @Get('search/employees')
  searchEmployees(@Query('q') query: string) {
    return this.personService.searchEmployees(query);
  }

  @Get('search/residents')
  searchResidents(@Query('q') query: string) {
    return this.personService.searchResidents(query);
  }

  @Post('sync-biometric')
  syncBiometricStatus() {
    return this.personService.syncBiometricStatus();
  }

  @Post('sync-from-device/:doorId')
  syncFromDevice(@Param('doorId') doorId: string) {
    return this.personService.syncFromDevice(doorId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.personService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePersonDto) {
    return this.personService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePersonDto) {
    return this.personService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.personService.remove(id);
  }

  @Get(':id/doors')
  getPersonDoors(@Param('id') id: string) {
    return this.personService.getPersonDoors(id);
  }
}
