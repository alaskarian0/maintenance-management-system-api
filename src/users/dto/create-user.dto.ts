export type PermissionKey = 'ACCESS_CONTROL' | 'DEVICE_IMPORT';

export class CreateUserDto {
  userName: string;
  fullName: string;
  password: string;
  role: 'ADMIN' | 'USER' | 'TECHNICIAN';
  workshopId?: string;
  permissions?: PermissionKey[];
}
