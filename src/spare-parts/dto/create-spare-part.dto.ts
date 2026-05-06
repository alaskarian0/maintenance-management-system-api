export class CreateSparePartDto {
  name: string;
  partNumber?: string;
  quantity?: number;
  minQuantity?: number;
  category?: string;
  notes?: string;
}
