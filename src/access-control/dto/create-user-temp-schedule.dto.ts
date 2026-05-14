import { IsString, IsNumber, IsBoolean, IsOptional, IsDateString, IsArray } from 'class-validator';

export class CreateUserTempScheduleDto {
  @IsString()
  personId: string;

  @IsOptional()
  @IsString()
  shiftClassId?: string;

  @IsDateString()
  comeTime: string;

  @IsDateString()
  leaveTime: string;

  @IsOptional()
  @IsNumber()
  scheduleType?: number;

  @IsOptional()
  @IsNumber()
  flag?: number;

  @IsOptional()
  @IsBoolean()
  overtime?: boolean;

  @IsOptional()
  @IsNumber()
  zktecoSchClassId?: number;
}

export class CreateBatchUserTempScheduleDto {
  @IsArray()
  schedules: CreateUserTempScheduleDto[];
}
