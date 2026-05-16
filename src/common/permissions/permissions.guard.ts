import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { PrismaService } from '../../prisma.service';

/**
 * Guard that checks whether the authenticated user has the required
 * permission(s) for the requested endpoint.
 *
 * It expects the frontend to send `x-user-id` and `x-user-role` headers
 * (set via the actorHeaders mechanism already in place).
 *
 * ADMIN-role users always pass regardless of stored permissions.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no permissions are required, allow access
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-user-id'] as string | undefined;
    const userRole = request.headers['x-user-role'] as string | undefined;

    // ADMIN always has full access
    if (userRole?.toUpperCase() === 'ADMIN') return true;

    // Need a valid userId to look up permissions
    if (!userId) {
      throw new ForbiddenException('المستخدم غير مخول للوصول');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { permissions: true },
    });

    if (!user) {
      throw new ForbiddenException('المستخدم غير موجود');
    }

    const userPermissions: string[] = Array.isArray(user.permissions)
      ? (user.permissions as unknown as string[])
      : [];

    const hasAll = required.every((perm) => userPermissions.includes(perm));

    if (!hasAll) {
      throw new ForbiddenException('ليس لديك صلاحية الوصول لهذا القسم');
    }

    return true;
  }
}
