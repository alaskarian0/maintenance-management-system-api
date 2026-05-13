import { DeviceNature } from '@prisma/client';

export class CreateDeviceDto {
  name?: string;
  categoryId: string;
  nature?: DeviceNature;
  notes?: string;
  serialNumbers?: string[];
  workshopId?: string;
}
