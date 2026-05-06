export class CreateFingerprintDto {
  personType: 'EMPLOYEE' | 'RESIDENT';
  name: string;
  personId?: number;
  region?: string;
  note?: string;
}
