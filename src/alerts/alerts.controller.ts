import { Controller, Get, Post, Param } from '@nestjs/common';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  getAllAlerts() {
    return this.alertsService.getAllAlerts();
  }

  @Get('expired-access')
  getExpiredAccess() {
    return this.alertsService.getExpiredAccess();
  }

  @Get('low-stock')
  getLowStockParts() {
    return this.alertsService.getLowStockParts();
  }

  @Post('expired-access/:personId/stop')
  stopExpiredAccess(@Param('personId') personId: string) {
    return this.alertsService.stopExpiredAccess(personId);
  }
}
