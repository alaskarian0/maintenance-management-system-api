export class CreateMaintenanceRecordDto {
  description: string;
  technicianName: string;
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  date: string;
}
