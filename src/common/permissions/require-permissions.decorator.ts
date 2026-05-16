import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from './permission-key';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to mark an endpoint as requiring specific permission(s).
 * The user must have ALL listed permissions (AND logic).
 *
 * @example
 * @RequirePermissions('ACCESS_CONTROL')
 * @Get() findAll() { ... }
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
