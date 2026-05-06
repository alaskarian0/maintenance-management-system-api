import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CreateDivisionDto } from './dto/create-division.dto';
import { CreateUnitDto } from './dto/create-unit.dto';

interface HierarchyEntity {
  id: number;
  name: string;
  entityCode: string;
  type: 'DEPARTMENT' | 'DIVISION' | 'WORKSHOP' | 'UNIT';
  isTerminated: boolean;
  parentId: number | null;
  children: HierarchyEntity[];
}

interface HierarchyResponse {
  success: boolean;
  data: HierarchyEntity[];
}

@Injectable()
export class DepartmentsService {
  private readonly logger = new Logger(DepartmentsService.name);

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

  async syncFromExternal() {
    const syncUrl = process.env.HIERARCHY_SYNC_URL;
    if (!syncUrl) {
      throw new Error('HIERARCHY_SYNC_URL is not configured in environment');
    }

    this.logger.log('Starting hierarchy sync from external source...');

    const response = await fetch(syncUrl);
    if (!response.ok) {
      throw new Error(`External API returned ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as HierarchyResponse;
    if (!json.success || !Array.isArray(json.data)) {
      throw new Error('Invalid response format from external API');
    }

    const stats = { departments: 0, divisions: 0, units: 0 };

    await this.prisma.$transaction(async (tx) => {
      for (const rootEntity of json.data) {
        if (rootEntity.isTerminated) continue;

        // Top-level entities with type DEPARTMENT are our departments
        // Some top-level items can be children of a parent — we only process root-level (parentId === null)
        if (rootEntity.parentId !== null) continue;

        const department = await tx.department.upsert({
          where: { name: rootEntity.name },
          update: {},
          create: { name: rootEntity.name },
        });
        stats.departments++;

        await this.processChildren(tx, rootEntity.children, department.id, stats);
      }
    });

    this.logger.log(
      `Sync complete: ${stats.departments} departments, ${stats.divisions} divisions, ${stats.units} units`,
    );

    return {
      success: true,
      message: `Synced ${stats.departments} departments, ${stats.divisions} divisions, ${stats.units} units`,
      stats,
    };
  }

  private async processChildren(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    children: HierarchyEntity[],
    departmentId: string,
    stats: { departments: number; divisions: number; units: number },
  ) {
    for (const child of children) {
      if (child.isTerminated) continue;

      switch (child.type) {
        case 'DIVISION':
        case 'WORKSHOP': {
          // Both DIVISION and WORKSHOP map to our Division model
          const division = await tx.division.upsert({
            where: {
              name_departmentId: { name: child.name, departmentId },
            },
            update: {},
            create: { name: child.name, departmentId },
          });
          stats.divisions++;

          // Process division's children as units
          if (child.children?.length) {
            await this.processUnits(tx, child.children, division.id, stats);
          }
          break;
        }
        case 'UNIT': {
          // Unit directly under department (no division) — create a default division
          const defaultDiv = await tx.division.upsert({
            where: {
              name_departmentId: { name: child.name, departmentId },
            },
            update: {},
            create: { name: child.name, departmentId },
          });
          stats.divisions++;

          if (child.children?.length) {
            await this.processUnits(tx, child.children, defaultDiv.id, stats);
          }
          break;
        }
        case 'DEPARTMENT': {
          // Nested department — treat as a department
          const dept = await tx.department.upsert({
            where: { name: child.name },
            update: {},
            create: { name: child.name },
          });
          stats.departments++;

          if (child.children?.length) {
            await this.processChildren(tx, child.children, dept.id, stats);
          }
          break;
        }
      }
    }
  }

  private async processUnits(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    children: HierarchyEntity[],
    divisionId: string,
    stats: { departments: number; divisions: number; units: number },
  ) {
    for (const child of children) {
      if (child.isTerminated) continue;

      if (child.type === 'UNIT') {
        await tx.unit.upsert({
          where: {
            name_divisionId: { name: child.name, divisionId },
          },
          update: {},
          create: { name: child.name, divisionId },
        });
        stats.units++;
      } else if (child.type === 'WORKSHOP' || child.type === 'DIVISION') {
        // Nested workshop/division under a division — map as unit for simplicity
        await tx.unit.upsert({
          where: {
            name_divisionId: { name: child.name, divisionId },
          },
          update: {},
          create: { name: child.name, divisionId },
        });
        stats.units++;
      }

      // Process any deeper children as units too
      if (child.children?.length) {
        await this.processUnits(tx, child.children, divisionId, stats);
      }
    }
  }
}
