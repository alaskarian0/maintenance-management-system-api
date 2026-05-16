import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ShiftClassService } from './shift-class.service';
import { CreateShiftClassDto } from './dto/create-shift-class.dto';
import { UpdateShiftClassDto } from './dto/update-shift-class.dto';
import { PermissionsGuard } from '../common/permissions/permissions.guard';
import { RequirePermissions } from '../common/permissions/require-permissions.decorator';

@Controller('access-control/shift-classes')
@UseGuards(PermissionsGuard)
@RequirePermissions('ACCESS_CONTROL')
export class ShiftClassController {
  constructor(private readonly shiftClassService: ShiftClassService) {}

  @Get()
  findAll() {
    return this.shiftClassService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shiftClassService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateShiftClassDto) {
    return this.shiftClassService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateShiftClassDto) {
    return this.shiftClassService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shiftClassService.remove(id);
  }
}
