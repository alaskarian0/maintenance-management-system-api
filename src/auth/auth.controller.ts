import {
  Body,
  Controller,
  Post,
  Put,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdminService } from '../admin/admin.service';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly adminService: AdminService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { userName?: string; password?: string },
  ) {
    const userName = body.userName?.trim() || '';
    const password = body.password ?? '';

    // 1. Try User table first (users created via admin management)
    if (userName) {
      const user = await this.prisma.user.findUnique({
        where: { userName },
      });
      if (user && user.isActive) {
        const match = await bcrypt.compare(password, user.passwordHash);
        if (match) {
          const permissions = Array.isArray(user.permissions)
            ? user.permissions
            : [];
          return {
            status: 'success' as const,
            data: {
              access_token: randomUUID(),
              user: {
                id: user.id,
                userName: user.userName,
                fullName: user.fullName,
                role: user.role,
                isTempPass: false,
                permissions,
              },
            },
          };
        }
      }
    }

    // 2. Fallback to legacy Admin table (single admin password)
    const ok = await this.adminService.verifyPassword(password);
    if (!ok) {
      throw new UnauthorizedException({
        message: 'Invalid username or password',
      });
    }

    return {
      status: 'success' as const,
      data: {
        access_token: randomUUID(),
        user: {
          id: 1,
          userName: userName || 'admin',
          fullName: 'مسؤول النظام',
          role: 'ADMIN',
          isTempPass: false,
          permissions: ['ACCESS_CONTROL', 'DEVICE_IMPORT'],
        },
      },
    };
  }

  @Put('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    const ok = await this.adminService.verifyPassword(body.currentPassword ?? '');
    if (!ok) {
      throw new UnauthorizedException({
        message: 'Current password is incorrect',
      });
    }
    if (!body.newPassword?.trim()) {
      throw new UnauthorizedException({ message: 'New password is required' });
    }
    await this.adminService.setPassword(body.newPassword.trim());
    return {
      status: 'success' as const,
      data: { success: true },
    };
  }
}
