import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { AccessPersonService } from './access-person.service';
import { AccessBiometricService } from './access-biometric.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { QueryPersonDto } from './dto/query-person.dto';
import { PrismaService } from '../prisma.service';

@Controller('access-control/persons')
export class AccessPersonController {
  constructor(
    private readonly personService: AccessPersonService,
    private readonly biometricService: AccessBiometricService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  findAll(@Query() query: QueryPersonDto) {
    return this.personService.findAll(query);
  }

  @Get('search/employees')
  searchEmployees(@Query('q') query: string) {
    return this.personService.searchEmployees(query);
  }

  @Get('search/residents')
  searchResidents(@Query('q') query: string) {
    return this.personService.searchResidents(query);
  }

  @Post('sync-biometric')
  syncBiometricStatus() {
    return this.personService.syncBiometricStatus();
  }

  @Get('pending-ops')
  getPendingOps() {
    return this.personService.getPendingOps();
  }

  @Post('sync-from-device/:doorId')
  syncFromDevice(@Param('doorId') doorId: string) {
    return this.personService.syncFromDevice(doorId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.personService.findOne(id);
  }

  @Post(':id/transfer-biometric/:targetDoorId')
  async transferBiometric(
    @Param('id') personId: string,
    @Param('targetDoorId') targetDoorId: string,
  ) {
    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new NotFoundException('Person not found');

    const door = await this.prisma.accessDoor.findUnique({ where: { id: targetDoorId } });
    if (!door) throw new NotFoundException('Target door not found');
    if (!door.ipAddress) throw new NotFoundException('Target door has no IP address');

    const result = await this.biometricService.transferTemplates(personId, door.ipAddress);
    return {
      person: person.name,
      door: door.name,
      fingersTransferred: result.fingers,
      faceTransferred: result.face,
    };
  }

  @Post(':id/push-to-device/:doorId')
  async pushToDevice(
    @Param('id') personId: string,
    @Param('doorId') doorId: string,
  ) {
    return this.personService.pushPersonToDevice(personId, doorId);
  }

  @Post()
  create(@Body() dto: CreatePersonDto) {
    return this.personService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePersonDto) {
    return this.personService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.personService.remove(id);
  }

  @Get(':id/doors')
  getPersonDoors(@Param('id') id: string) {
    return this.personService.getPersonDoors(id);
  }
}
