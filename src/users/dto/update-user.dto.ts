export class UpdateUserDto {
  fullName?: string;
  userName?: string;
  role?: 'ADMIN' | 'USER' | 'TECHNICIAN';
  isActive?: boolean;
  password?: string;
  workshopId?: string;
}
