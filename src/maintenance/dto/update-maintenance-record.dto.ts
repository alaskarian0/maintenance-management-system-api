import type { PartUsedDto } from './create-maintenance-record.dto';

export class UpdateMaintenanceRecordDto {
  description?: string;
  technicianName?: string;
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  date?: string;
  partsUsed?: PartUsedDto[];
}
