import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { AccessPermissionService } from './access-permission.service';

@Controller('access-control/permissions')
export class AccessPermissionController {
  constructor(private readonly permService: AccessPermissionService) {}

  @Get()
  findAll() {
    return this.permService.findAll();
  }

  @Post()
  grant(
    @Body() body: { personId: string; doorId: string; grantedBy?: string },
  ) {
    return this.permService.grant(body.personId, body.doorId, body.grantedBy);
  }

  @Post('bulk')
  bulkGrant(
    @Body() body: { personId: string; doorIds: string[]; grantedBy?: string },
  ) {
    return this.permService.bulkGrant(
      body.personId,
      body.doorIds,
      body.grantedBy,
    );
  }

  @Delete(':id')
  revoke(@Param('id') id: string) {
    return this.permService.revoke(id);
  }

  @Delete()
  revokeByPersonDoor(
    @Query('personId') personId: string,
    @Query('doorId') doorId: string,
  ) {
    return this.permService.revokeByPersonDoor(personId, doorId);
  }
}
