import { DeviceNature, DeviceItemStatus } from '@prisma/client';

export class QueryDeviceDto {
  search?: string;
  categoryId?: string;
  deviceTypeId?: string;
  departmentId?: string;
  itemStatus?: DeviceItemStatus;
  nature?: DeviceNature;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  limit?: string;
  userWorkshopId?: string;
  userRole?: string;
}
