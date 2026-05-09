export class UpdatePersonDto {
  name?: string;
  empCode?: string;
  region?: string;
  note?: string;
  phone?: string;
  isActive?: boolean;
  accessType?: 'permanent' | 'temporary';
  accessEndDate?: string;
}
