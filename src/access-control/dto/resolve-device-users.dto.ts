import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ResolveItemDto {
  @IsString()
  uid: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  name: string;

  @IsIn(['bind', 'create', 'merge', 'skip'])
  action: 'bind' | 'create' | 'merge' | 'skip';

  @IsOptional()
  @IsString()
  accessPersonId?: string;

  @IsOptional()
  @IsString()
  fingerprintRecordId?: string;

  @IsOptional()
  @IsString()
  secondaryPersonId?: string;

  @IsOptional()
  resolvedFields?: {
    name?: string;
    region?: string;
    note?: string;
    personType?: string;
    personId?: number;
  };
}

export class BatchResolveDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResolveItemDto)
  resolutions: ResolveItemDto[];

  @IsOptional()
  @IsString()
  doorId?: string;
}
