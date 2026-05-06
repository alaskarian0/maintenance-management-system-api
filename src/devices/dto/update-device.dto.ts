import { DeviceNature } from '@prisma/client';

export class UpdateDeviceDto {
  name?: string;
  categoryId?: string;
  nature?: DeviceNature;
  notes?: string;
}
