import { PartialType } from '@nestjs/mapped-types';
import { CreateShiftClassDto } from './create-shift-class.dto';

export class UpdateShiftClassDto extends PartialType(CreateShiftClassDto) {}
