import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { VerifyPasswordDto } from './dto/verify-password.dto';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Body() dto: VerifyPasswordDto) {
    const ok = await this.adminService.verifyPassword(dto.password ?? '');
    return { ok };
  }
}
