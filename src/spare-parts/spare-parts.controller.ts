import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SparePartsService } from './spare-parts.service';
import { CreateSparePartDto } from './dto/create-spare-part.dto';
import { BulkImportSparePartsDto } from './dto/bulk-import-spare-parts.dto';
import { UpdateSparePartDto } from './dto/update-spare-part.dto';
import { UseSparePartDto } from './dto/use-spare-part.dto';

@Controller('spare-parts')
export class SparePartsController {
  constructor(private readonly sparePartsService: SparePartsService) {}

  @Get()
  findAll(@Query('search') search?: string) {
    return this.sparePartsService.findAll(search);
  }

  @Get('low-stock')
  lowStock() {
    return this.sparePartsService.lowStock();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sparePartsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSparePartDto) {
    return this.sparePartsService.create(dto);
  }

  @Post('bulk-import')
  bulkImport(@Body() dto: BulkImportSparePartsDto) {
    return this.sparePartsService.bulkImport(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSparePartDto) {
    return this.sparePartsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sparePartsService.remove(id);
  }

  @Post(':id/use')
  use(
    @Param('id') id: string,
    @Body() dto: UseSparePartDto,
  ) {
    return this.sparePartsService.useStock(
      id,
      dto.quantityUsed,
      dto.maintenanceId,
    );
  }
}
