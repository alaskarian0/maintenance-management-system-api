import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.findForUser(
      userId,
      limit ? Number(limit) : 50,
    );
  }

  @Get('unread-count')
  unreadCount(@Query('userId') userId?: string) {
    return this.notificationsService
      .unreadCount(userId)
      .then((count) => ({ count }));
  }

  /** Static path must be registered before `:id/read` or `mark-all-read` is captured as id. */
  @Patch('mark-all-read')
  markAllRead(@Query('userId') userId?: string) {
    return this.notificationsService.markAllRead(userId);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }

  @Post()
  create(
    @Body()
    body: {
      userId?: string | null;
      type: string;
      title: string;
      message: string;
      relatedId?: string | null;
    },
  ) {
    return this.notificationsService.create(body);
  }

  @Post('scan')
  scan() {
    return this.notificationsService.scan();
  }
}
