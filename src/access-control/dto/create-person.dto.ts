export class CreatePersonDto {
  personType: 'EMPLOYEE' | 'RESIDENT' | 'OTHER';
  name: string;
  personId?: number;
  empCode?: string;
  identifier?: string;
  region?: string;
  note?: string;
  phone?: string;
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
