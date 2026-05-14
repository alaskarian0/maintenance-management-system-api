import { IsString, IsNumber, IsBoolean, IsOptional, IsDateString } from 'class-validator';

export class CreateShiftClassDto {
  @IsNumber()
  zktecoSchClassId: number;

  @IsString()
  name: string;

  @IsDateString()
  startTime: string;

  @IsDateString()
  endTime: string;

  @IsOptional()
  @IsNumber()
  lateMinutes?: number;

  @IsOptional()
  @IsNumber()
  earlyMinutes?: number;

  @IsOptional()
  @IsBoolean()
  checkIn?: boolean;

  @IsOptional()
  @IsBoolean()
  checkOut?: boolean;

  @IsOptional()
  @IsNumber()
  workDay?: number;

  @IsOptional()
  @IsNumber()
  color?: number;
}
