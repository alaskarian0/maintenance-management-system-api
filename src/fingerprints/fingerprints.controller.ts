import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { FingerprintsService } from './fingerprints.service';
import { CreateFingerprintDto } from './dto/create-fingerprint.dto';
import { UpdateFingerprintDto } from './dto/update-fingerprint.dto';

@Controller('fingerprints')
export class FingerprintsController {
  constructor(private readonly fingerprintsService: FingerprintsService) {}

  @Get()
  findAll(@Query('personType') personType?: string) {
    return this.fingerprintsService.findAll(personType);
  }

  @Get('employees/search')
  searchEmployees(@Query('q') query: string) {
    return this.fingerprintsService.searchEmployees(query);
  }

  @Get('residents/search')
  searchResidents(@Query('q') query: string) {
    return this.fingerprintsService.searchResidents(query);
  }

  @Post()
  create(@Body() dto: CreateFingerprintDto) {
    return this.fingerprintsService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFingerprintDto) {
    return this.fingerprintsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.fingerprintsService.remove(id);
  }
}
