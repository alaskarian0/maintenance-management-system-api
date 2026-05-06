import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateDeviceTypeDto } from './dto/create-device-type.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get('types')
  findAllTypes() {
    return this.categoriesService.findAllTypes();
  }

  @Post('types')
  createType(@Body() dto: CreateDeviceTypeDto) {
    return this.categoriesService.createType(dto);
  }

  @Delete('types/:id')
  removeType(@Param('id') id: string) {
    return this.categoriesService.removeType(id);
  }

  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}
