import { MaintenanceStatus } from '@prisma/client';

export class BulkMaintenanceStatusDto {
  ids: string[];
  status: MaintenanceStatus;
}
