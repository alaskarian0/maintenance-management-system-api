import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { UserTempScheduleService } from './user-temp-schedule.service';
import { CreateUserTempScheduleDto, CreateBatchUserTempScheduleDto } from './dto/create-user-temp-schedule.dto';

@Controller('access-control/temp-schedules')
export class UserTempScheduleController {
  constructor(private readonly scheduleService: UserTempScheduleService) {}

  @Get('person/:personId')
  findByPerson(
    @Param('personId') personId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.scheduleService.findByPerson(personId, startDate, endDate);
  }

  @Get('range')
  findByDateRange(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.scheduleService.findByDateRange(startDate, endDate);
  }

  @Get('stats')
  getStats() {
    return this.scheduleService.getScheduleStats();
  }

  @Post()
  create(@Body() dto: CreateUserTempScheduleDto) {
    return this.scheduleService.create(dto);
  }

  @Post('batch')
  createBatch(@Body() dto: CreateBatchUserTempScheduleDto) {
    return this.scheduleService.createBatch(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.scheduleService.remove(id);
  }

  @Delete('person/:personId')
  removeByPerson(@Param('personId') personId: string) {
    return this.scheduleService.removeByPerson(personId);
  }
}
