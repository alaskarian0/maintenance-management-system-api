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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AccessPersonService } from './access-person.service';
import { AccessBiometricService } from './access-biometric.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { QueryPersonDto } from './dto/query-person.dto';
import { EnrollFingerprintDto } from './dto/enroll-fingerprint.dto';
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

  @Post(':id/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadDir = join(process.cwd(), 'uploads', 'persons');
          if (!existsSync(uploadDir)) {
            mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, uniqueSuffix + extname(file.originalname));
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const person = await this.prisma.accessPerson.findUnique({ where: { id } });
    if (!person) throw new NotFoundException('Person not found');

    const photoUrl = `/uploads/persons/${file.filename}`;
    await this.prisma.accessPerson.update({
      where: { id },
      data: { photoUrl },
    });

    return { photoUrl };
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

    const door = await this.prisma.accessDoor.findUnique({
      where: { id: targetDoorId },
      include: { devices: true },
    });
    if (!door) throw new NotFoundException('Target door not found');

    const device = door.devices.find(d => d.ipAddress);
    if (!device?.ipAddress) throw new NotFoundException('Target door has no device with IP address');

    const result = await this.biometricService.transferTemplates(personId, device.ipAddress);
    return {
      person: person.name,
      door: door.name,
      device: device.name,
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

  @Post(':id/enroll-fingerprint')
  async enrollFingerprint(
    @Param('id') personId: string,
    @Body() dto: EnrollFingerprintDto,
  ) {
    const person = await this.prisma.accessPerson.findUnique({ where: { id: personId } });
    if (!person) throw new NotFoundException('Person not found');

    const device = await this.prisma.accessDevice.findUnique({ where: { id: dto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    if (!device.ipAddress) throw new NotFoundException('Device has no IP address configured');

    return this.biometricService.enrollFingerprint(personId, device.ipAddress, dto.fingerIndex);
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

  @Get(':id/device-status')
  checkPersonOnDevices(@Param('id') id: string) {
    return this.personService.checkPersonOnDevices(id);
  }
}
