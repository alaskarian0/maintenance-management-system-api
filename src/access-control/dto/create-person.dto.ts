export class CreatePersonDto {
  personType: 'EMPLOYEE' | 'RESIDENT';
  name: string;
  personId?: number;
  empCode?: string;
  region?: string;
  note?: string;
  phone?: string;
  accessType?: 'permanent' | 'temporary';
  accessEndDate?: string;
}
