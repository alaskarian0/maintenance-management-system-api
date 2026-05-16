export class UpdatePersonDto {
  name?: string;
  empCode?: string;
  identifier?: string;
  region?: string;
  note?: string;
  phone?: string;
  isActive?: boolean;
  accessType?: 'permanent' | 'temporary';
  accessEndDate?: string;
  birthDate?: string;
  courtNumber?: string;
  departmentId?: string;
  unitId?: string;
  hireDate?: string;
  role?: 'user' | 'admin';
  photoUrl?: string;
}
