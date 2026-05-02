import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdminService } from '../admin/admin.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly adminService: AdminService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { userName?: string; password?: string },
  ) {
    const ok = await this.adminService.verifyPassword(body.password ?? '');
    if (!ok) {
      throw new UnauthorizedException({
        message: 'Invalid username or password',
      });
    }
    const userName = body.userName?.trim() || 'admin';
    return {
      status: 'success' as const,
      data: {
        access_token: randomUUID(),
        user: {
          id: 1,
          userName,
          fullName: 'مسؤول النظام',
          role: 'admin',
          isTempPass: false,
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
