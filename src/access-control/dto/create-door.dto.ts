export class CreateDoorDto {
  name: string;
  location?: string;
  group?: 'INSIDE' | 'OUTSIDE';
  ipAddress?: string;
  serialNumber?: string;
}
