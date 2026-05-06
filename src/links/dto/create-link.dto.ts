import { SystemType } from '@prisma/client';

export class CreateLinkDto {
  name: string;
  url: string;
  apiUrl?: string;
  systemType?: SystemType;
}
