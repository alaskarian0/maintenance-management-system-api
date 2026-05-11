import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateAdminLetterDto } from './dto/create-admin-letter.dto';
import { UpdateAdminLetterDto } from './dto/update-admin-letter.dto';
import { AddLetterPersonDto } from './dto/add-letter-person.dto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AdminLettersService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads', 'admin-letters');

  constructor(private prisma: PrismaService) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async findAll(params: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.adminLetter.findMany({
        where,
        orderBy: { letterDate: 'desc' },
        skip,
        take: limit,
        include: {
          persons: { orderBy: { createdAt: 'desc' } },
          _count: { select: { persons: true } },
        },
      }),
      this.prisma.adminLetter.count({ where }),
    ]);

    return {
      data: data.map((letter) => ({
        ...letter,
        personsCount: letter._count.persons,
        _count: undefined,
      })),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string) {
    return this.prisma.adminLetter.findUnique({
      where: { id },
      include: {
        persons: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async create(dto: CreateAdminLetterDto, file: Express.Multer.File) {
    const relativePath = path.join('uploads', 'admin-letters', file.filename);

    return this.prisma.adminLetter.create({
      data: {
        title: dto.title,
        referenceNumber: dto.referenceNumber || null,
        letterDate: new Date(dto.letterDate),
        pdfPath: relativePath,
        originalFileName: file.originalname,
        notes: dto.notes || null,
      },
      include: { persons: true },
    });
  }

  async update(id: string, dto: UpdateAdminLetterDto) {
    const existing = await this.prisma.adminLetter.findUnique({ where: { id } });
    if (!existing) return null;

    return this.prisma.adminLetter.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.referenceNumber !== undefined && { referenceNumber: dto.referenceNumber }),
        ...(dto.letterDate !== undefined && { letterDate: new Date(dto.letterDate) }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: { persons: true },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.adminLetter.findUnique({ where: { id } });
    if (!existing) return null;

    const fullPath = path.resolve(existing.pdfPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    await this.prisma.adminLetter.delete({ where: { id } });
    return true;
  }

  async findByPerson(personType: string, personId: number) {
    return this.prisma.adminLetterPerson.findMany({
      where: {
        personType: personType as any,
        personId,
      },
      include: {
        letter: {
          include: {
            persons: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByPersonName(personType: string, personName: string) {
    return this.prisma.adminLetterPerson.findMany({
      where: {
        personType: personType as any,
        personName: { contains: personName, mode: 'insensitive' },
      },
      include: {
        letter: {
          include: {
            persons: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPersons(letterId: string) {
    const letter = await this.prisma.adminLetter.findUnique({
      where: { id: letterId },
    });
    if (!letter) throw new NotFoundException('Letter not found');

    return this.prisma.adminLetterPerson.findMany({
      where: { letterId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addPerson(letterId: string, dto: AddLetterPersonDto) {
    const letter = await this.prisma.adminLetter.findUnique({
      where: { id: letterId },
    });
    if (!letter) throw new NotFoundException('Letter not found');

    const existing = await this.prisma.adminLetterPerson.findFirst({
      where: {
        letterId,
        personType: dto.personType,
        personId: dto.personId ?? null,
        personName: dto.personName,
      },
    });
    if (existing) {
      throw new ConflictException('هذا الشخص مرتبط بالكتاب مسبقاً');
    }

    return this.prisma.adminLetterPerson.create({
      data: {
        letterId,
        personType: dto.personType,
        personName: dto.personName,
        personId: dto.personId || null,
        note: dto.note || null,
      },
    });
  }

  async removePerson(letterId: string, personLinkId: string) {
    const link = await this.prisma.adminLetterPerson.findUnique({
      where: { id: personLinkId },
    });
    if (!link || link.letterId !== letterId) {
      throw new NotFoundException('Person link not found');
    }
    await this.prisma.adminLetterPerson.delete({ where: { id: personLinkId } });
  }

  async getLetterCountsByPersons(persons: { personType: string; personId: number | null }[]) {
    const counts: Record<string, number> = {};

    for (const person of persons) {
      if (person.personId == null) continue;
      const key = `${person.personType}:${person.personId}`;
      if (key in counts) continue;

      const count = await this.prisma.adminLetterPerson.count({
        where: {
          personType: person.personType as any,
          personId: person.personId,
        },
      });
      counts[key] = count;
    }

    return counts;
  }
}
