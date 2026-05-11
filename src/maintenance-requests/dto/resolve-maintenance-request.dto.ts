export class ResolveMaintenanceRequestDto {
  technicianName: string;
  description?: string;
  date?: string;
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  partsUsed?: { name: string; quantity: number }[];
}
