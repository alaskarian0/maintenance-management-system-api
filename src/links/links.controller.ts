import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CreateLinkDto } from './dto/create-link.dto';
import { SetMaintenanceDto } from './dto/set-maintenance.dto';
import { LinksService } from './links.service';

@Controller('links')
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Get('health')
  health() {
    return this.linksService.healthBatch();
  }

  @Get('status-summary')
  statusSummary() {
    return this.linksService.statusSummary();
  }

  @Get()
  findAll() {
    return this.linksService.findAll();
  }

  @Get(':id/details')
  details(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit != null ? parseInt(limit, 10) : 20;
    return this.linksService.getDetails(id, Number.isFinite(n) ? n : 20);
  }

  @Get(':id/status-logs')
  statusLogs(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const lim = limit != null ? parseInt(limit, 10) : 20;
    const off = offset != null ? parseInt(offset, 10) : 0;
    return this.linksService.statusLogs(
      id,
      Number.isFinite(lim) ? lim : 20,
      Number.isFinite(off) ? off : 0,
    );
  }

  @Post(':id/check')
  @HttpCode(HttpStatus.OK)
  check(@Param('id') id: string) {
    return this.linksService.checkAndLog(id);
  }

  @Post(':id/maintenance')
  @HttpCode(HttpStatus.OK)
  maintenance(@Param('id') id: string, @Body() dto: SetMaintenanceDto) {
    return this.linksService.setMaintenance(id, !!dto.isMaintenance);
  }

  @Get(':id/ping')
  ping(@Param('id') id: string) {
    return this.linksService.pingById(id);
  }

  @Post()
  create(@Body() dto: CreateLinkDto) {
    return this.linksService.create(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.linksService.remove(id);
  }
}
