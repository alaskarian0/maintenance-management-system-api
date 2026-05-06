import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CreateDivisionDto } from './dto/create-division.dto';
import { CreateUnitDto } from './dto/create-unit.dto';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  findAll() {
    return this.departmentsService.findAll();
  }

  @Post('sync')
  syncFromExternal() {
    return this.departmentsService.syncFromExternal();
  }

  @Post()
  createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.departmentsService.createDepartment(dto);
  }

  @Delete(':id')
  removeDepartment(@Param('id') id: string) {
    return this.departmentsService.removeDepartment(id);
  }

  @Post(':departmentId/divisions')
  createDivision(
    @Param('departmentId') departmentId: string,
    @Body() dto: CreateDivisionDto,
  ) {
    return this.departmentsService.createDivision(departmentId, dto);
  }

  @Delete('divisions/:divisionId')
  removeDivision(@Param('divisionId') divisionId: string) {
    return this.departmentsService.removeDivision(divisionId);
  }

  @Post('divisions/:divisionId/units')
  createUnit(
    @Param('divisionId') divisionId: string,
    @Body() dto: CreateUnitDto,
  ) {
    return this.departmentsService.createUnit(divisionId, dto);
  }

  @Delete('divisions/units/:unitId')
  removeUnit(@Param('unitId') unitId: string) {
    return this.departmentsService.removeUnit(unitId);
  }
}
