export class UpdateDeviceDto {
  name?: string;
  side?: 'INSIDE' | 'OUTSIDE';
  serialNumber?: string;
  ipAddress?: string;
  zkTerminalId?: number;
  isAttendance?: boolean;
}
