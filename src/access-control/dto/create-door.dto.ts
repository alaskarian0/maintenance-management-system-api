export class CreateDoorDto {
  name: string;
  location?: string;
  group?: 'INSIDE' | 'OUTSIDE';
  serialNumber?: string;
  ipAddress?: string;
  zkTerminalId?: number;
}
