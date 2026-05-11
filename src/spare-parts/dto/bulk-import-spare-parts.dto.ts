export class BulkImportSparePartRowDto {
  name: string;
  partNumber?: string;
  quantity?: number;
  minQuantity?: number;
  category?: string;
  notes?: string;
}

export class BulkImportSparePartsDto {
  rows: BulkImportSparePartRowDto[];
}
