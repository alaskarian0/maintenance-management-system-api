import { Controller, Get, Post, Body, Put, Param, Delete } from '@nestjs/common';
import { WorkshopsService } from './workshops.service';
import { CreateWorkshopDto, UpdateWorkshopDto } from './dto/workshop.dto';

@Controller('workshops')
export class WorkshopsController {
  constructor(private readonly workshopsService: WorkshopsService) {}

  @Post()
  create(@Body() createWorkshopDto: CreateWorkshopDto) {
    return this.workshopsService.create(createWorkshopDto);
  }

  @Get()
  findAll() {
    return this.workshopsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workshopsService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateWorkshopDto: UpdateWorkshopDto) {
    return this.workshopsService.update(id, updateWorkshopDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workshopsService.remove(id);
  }
}
