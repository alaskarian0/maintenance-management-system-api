import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CreateLinkDto } from './dto/create-link.dto';
import { LinksService } from './links.service';

@Controller('links')
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Get()
  findAll() {
    return this.linksService.findAll();
  }

  @Post()
  create(@Body() dto: CreateLinkDto) {
    return this.linksService.create(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.linksService.remove(id);
  }
}
