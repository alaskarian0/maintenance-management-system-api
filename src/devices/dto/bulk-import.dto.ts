import { DeviceNature } from '@prisma/client';

export class BulkImportRowDto {
  name?: string;
  categoryId: string;
  nature?: DeviceNature;
  serialNumber: string;
}

export class BulkImportDto {
  rows: BulkImportRowDto[];
}
