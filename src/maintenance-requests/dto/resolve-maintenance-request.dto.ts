export class ResolveMaintenanceRequestDto {
  technicianName: string;
  description?: string;
  partsUsed?: { name: string; quantity: number }[];
}
