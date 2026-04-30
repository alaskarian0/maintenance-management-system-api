import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AdminService {
  private readonly saltRounds = 10;

  constructor(private prisma: PrismaService) {}

  async ensureAdminExists(): Promise<void> {
    const initial = process.env.ADMIN_INITIAL_PASSWORD?.trim() || 'admin';
    const admin = await this.prisma.admin.findFirst();
    if (!admin) {
      const passwordHash = await bcrypt.hash(initial, this.saltRounds);
      await this.prisma.admin.create({
        data: { passwordHash, updatedAt: new Date() },
      });
      return;
    }
    // If env password is set, sync DB to match it (so .env always wins after restart)
    if (process.env.ADMIN_INITIAL_PASSWORD?.trim()) {
      const matches = await bcrypt.compare(initial, admin.passwordHash);
      if (!matches) {
        const passwordHash = await bcrypt.hash(initial, this.saltRounds);
        await this.prisma.admin.update({
          where: { id: admin.id },
          data: { passwordHash, updatedAt: new Date() },
        });
      }
    }
  }

  async verifyPassword(password: string): Promise<boolean> {
    await this.ensureAdminExists();
    const admin = await this.prisma.admin.findFirst();
    if (!admin) return false;
    return bcrypt.compare(password, admin.passwordHash);
  }

  async setPassword(newPassword: string): Promise<void> {
    await this.ensureAdminExists();
    const admin = await this.prisma.admin.findFirst();
    if (!admin) return;
    const passwordHash = await bcrypt.hash(newPassword, this.saltRounds);
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { passwordHash, updatedAt: new Date() },
    });
  }
}
