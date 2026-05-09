import { FingerprintPersonType } from '@prisma/client';

export class AddLetterPersonDto {
  personType: FingerprintPersonType;
  personName: string;
  personId?: number;
  note?: string;
}
