export class CreateUserDto {
  userName: string;
  fullName: string;
  password: string;
  role: 'ADMIN' | 'USER' | 'TECHNICIAN';
  workshopId?: string;
}
