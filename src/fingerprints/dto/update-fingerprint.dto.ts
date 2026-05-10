export class UpdateFingerprintDto {
  personType?: 'EMPLOYEE' | 'RESIDENT';
  personId?: number;
  name?: string;
  region?: string;
  note?: string;
}
