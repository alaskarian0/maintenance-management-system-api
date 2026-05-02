import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }

  create(dto: CreateCategoryDto) {
    return this.prisma.category.create({ data: { name: dto.name } });
  }

  remove(id: string) {
    return this.prisma.category.delete({ where: { id } });
  }
}
