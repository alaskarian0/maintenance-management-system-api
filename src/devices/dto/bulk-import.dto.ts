import { DeviceNature } from '@prisma/client';

export class BulkImportRowDto {
  name?: string;
  categoryName: string;
  deviceTypeName?: string;
  nature?: DeviceNature;
  serialNumber: string;
}

export class BulkImportDto {
  rows: BulkImportRowDto[];
}
