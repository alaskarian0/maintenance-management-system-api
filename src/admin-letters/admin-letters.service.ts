import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateAdminLetterDto } from './dto/create-admin-letter.dto';
import { UpdateAdminLetterDto } from './dto/update-admin-letter.dto';
import { AddLetterPersonDto } from './dto/add-letter-person.dto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AdminLettersService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads', 'admin-letters');
  private readonly logger = new Logger(AdminLettersService.name);

  constructor(private prisma: PrismaService) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private async enrichPersonsWithAccessStatus(persons: any[]) {
    const accessPersons = await this.prisma.accessPerson.findMany({
      where: {
        deletedAt: null,
        OR: persons
          .filter((p) => p.personId != null)
          .map((p) => ({
            personType: p.personType,
            personId: p.personId,
          })),
      },
      select: {
        id: true,
        personType: true,
        personId: true,
        isActive: true,
        accessType: true,
        accessEndDate: true,
        name: true,
        permissions: {
          select: {
            doorId: true,
            door: { select: { id: true, name: true } },
          },
        },
      },
    });

    const accessMap = new Map<string, (typeof accessPersons)[number]>();
    for (const ap of accessPersons) {
      accessMap.set(`${ap.personType}:${ap.personId}`, ap);
    }

    return persons.map((p) => {
      const key = p.personId != null ? `${p.personType}:${p.personId}` : null;
      const accessPerson = key ? accessMap.get(key) : null;

      let accessStatus: 'registered_active' | 'registered_inactive' | 'not_registered';
      if (!accessPerson) {
        accessStatus = 'not_registered';
      } else if (accessPerson.isActive) {
        accessStatus = 'registered_active';
      } else {
        accessStatus = 'registered_inactive';
      }

      return {
        ...p,
        accessStatus,
        accessPersonId: accessPerson?.id ?? null,
        accessPersonIsActive: accessPerson?.isActive ?? null,
        accessType: accessPerson?.accessType ?? null,
        accessEndDate: accessPerson?.accessEndDate ?? null,
        permissionCount: accessPerson?.permissions?.length ?? 0,
      };
    });
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
    const letter = await this.prisma.adminLetter.findUnique({
      where: { id },
      include: {
        persons: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!letter) return null;

    const enrichedPersons = await this.enrichPersonsWithAccessStatus(letter.persons);

    return {
      ...letter,
      persons: enrichedPersons,
    };
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

  async togglePersonAccess(letterPersonId: string) {
    const letterPerson = await this.prisma.adminLetterPerson.findUnique({
      where: { id: letterPersonId },
    });
    if (!letterPerson) {
      throw new NotFoundException('Person link not found');
    }

    if (letterPerson.personId == null) {
      throw new BadRequestException('لا يمكن التحكم بالوصول: الشخص ليس لديه رقم تعريف (personId)');
    }

    const accessPerson = await this.prisma.accessPerson.findFirst({
      where: {
        personType: letterPerson.personType as any,
        personId: letterPerson.personId,
        deletedAt: null,
      },
    });

    if (!accessPerson) {
      throw new NotFoundException('الشخص غير مسجّل في نظام التحكم بالدخول');
    }

    const newActiveState = !accessPerson.isActive;

    const updated = await this.prisma.accessPerson.update({
      where: { id: accessPerson.id },
      data: { isActive: newActiveState },
    });

    this.logger.log(
      `Access toggled for "${accessPerson.name}" (${accessPerson.id}): ${newActiveState ? 'active' : 'inactive'}`,
    );

    return {
      success: true,
      accessPersonId: updated.id,
      isActive: updated.isActive,
      personName: updated.name,
      action: newActiveState ? 'activated' : 'deactivated',
    };
  }

  async bulkToggleAccess(letterId: string, activate: boolean) {
    const letter = await this.prisma.adminLetter.findUnique({
      where: { id: letterId },
      include: { persons: true },
    });
    if (!letter) {
      throw new NotFoundException('Letter not found');
    }

    const persons = letter.persons.filter((p) => p.personId != null);
    if (persons.length === 0) {
      return {
        success: true,
        updated: 0,
        skipped: letter.persons.length,
        message: 'لا يوجد أشخاص بأرقام تعريف للتحكم بهم',
      };
    }

    const accessPersons = await this.prisma.accessPerson.findMany({
      where: {
        deletedAt: null,
        OR: persons.map((p) => ({
          personType: p.personType,
          personId: p.personId!,
        })),
      },
    });

    let updated = 0;
    let skipped = 0;

    for (const accessPerson of accessPersons) {
      if (accessPerson.isActive === activate) {
        skipped++;
        continue;
      }

      await this.prisma.accessPerson.update({
        where: { id: accessPerson.id },
        data: { isActive: activate },
      });
      updated++;
    }

    const notFound = persons.length - accessPersons.length;

    this.logger.log(
      `Bulk access toggle for letter ${letterId}: ${updated} updated, ${skipped} skipped, ${notFound} not found in access system`,
    );

    return {
      success: true,
      updated,
      skipped,
      notFound,
      action: activate ? 'activated' : 'deactivated',
    };
  }
}
