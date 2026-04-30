import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateLinkDto } from './dto/create-link.dto';

@Injectable()
export class LinksService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.link.findMany({ orderBy: { createdAt: 'asc' } });
  }

  create(dto: CreateLinkDto) {
    return this.prisma.link.create({
      data: { name: dto.name, url: dto.url },
    });
  }

  remove(id: string) {
    return this.prisma.link.delete({ where: { id } });
  }
}
