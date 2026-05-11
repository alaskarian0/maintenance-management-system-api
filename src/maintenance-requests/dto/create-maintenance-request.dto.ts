import { MaintenancePriority } from '@prisma/client';

export class CreateMaintenanceRequestDto {
  deviceItemId: string;
  description: string;
  priority?: MaintenancePriority;
  requestedBy: string;
  assignedTo?: string;
  notes?: string;
}
