import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateWorkshopDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateWorkshopDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedToSeeIds?: string[];
}
