export class UpdateSparePartDto {
  name?: string;
  partNumber?: string | null;
  quantity?: number;
  minQuantity?: number;
  category?: string | null;
  notes?: string | null;
}
