import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CreateDivisionDto } from './dto/create-division.dto';
import { CreateUnitDto } from './dto/create-unit.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.department.findMany({
      include: { divisions: { include: { units: true } } },
      orderBy: { name: 'asc' },
    });
  }

  createDepartment(dto: CreateDepartmentDto) {
    return this.prisma.department.create({ data: { name: dto.name } });
  }

  removeDepartment(id: string) {
    return this.prisma.department.delete({ where: { id } });
  }

  createDivision(departmentId: string, dto: CreateDivisionDto) {
    return this.prisma.division.create({ data: { name: dto.name, departmentId } });
  }

  removeDivision(divisionId: string) {
    return this.prisma.division.delete({ where: { id: divisionId } });
  }

  createUnit(divisionId: string, dto: CreateUnitDto) {
    return this.prisma.unit.create({ data: { name: dto.name, divisionId } });
  }

  removeUnit(unitId: string) {
    return this.prisma.unit.delete({ where: { id: unitId } });
  }
}
