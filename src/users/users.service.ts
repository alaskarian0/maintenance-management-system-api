import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  private readonly saltRounds = 10;

  constructor(private prisma: PrismaService) {}

  private readonly userSelect = {
    id: true,
    userName: true,
    fullName: true,
    role: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.UserSelect;

  async findAll() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: this.userSelect,
    });
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { userName: dto.userName },
    });
    if (existing) {
      throw new ConflictException('اسم المستخدم موجود بالفعل');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    return this.prisma.user.create({
      data: {
        userName: dto.userName,
        fullName: dto.fullName,
        passwordHash,
        role: dto.role,
      },
      select: this.userSelect,
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    if (dto.userName && dto.userName !== user.userName) {
      const existing = await this.prisma.user.findUnique({
        where: { userName: dto.userName },
      });
      if (existing) {
        throw new ConflictException('اسم المستخدم موجود بالفعل');
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.userName !== undefined) data.userName = dto.userName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, this.saltRounds);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: this.userSelect,
    });
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }
}
