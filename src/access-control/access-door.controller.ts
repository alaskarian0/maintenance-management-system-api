import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { AccessDoorService } from './access-door.service';
import { AccessSyncScheduler } from './access-sync.scheduler';
import { CreateDoorDto } from './dto/create-door.dto';
import { UpdateDoorDto } from './dto/update-door.dto';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

@Controller('access-control/doors')
export class AccessDoorController {
  constructor(
    private readonly doorService: AccessDoorService,
    private readonly syncScheduler: AccessSyncScheduler,
  ) {}

  // ── System Status ────────────────────────────────────────────────

  @Get('system-status')
  systemStatus() {
    return this.syncScheduler.status;
  }

  // ── Door CRUD ────────────────────────────────────────────────────

  @Get()
  findAll() {
    return this.doorService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.doorService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDoorDto) {
    return this.doorService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDoorDto) {
    return this.doorService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.doorService.remove(id);
  }

  @Get(':id/persons')
  getDoorPersons(@Param('id') id: string) {
    return this.doorService.getDoorPersons(id);
  }

  // ── Device CRUD (nested under doors) ─────────────────────────────

  @Post(':id/devices')
  createDevice(@Param('id') doorId: string, @Body() dto: CreateDeviceDto) {
    return this.doorService.createDevice(doorId, dto);
  }

  @Patch(':id/devices/:deviceId')
  updateDevice(
    @Param('id') doorId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateDeviceDto,
  ) {
    return this.doorService.updateDevice(doorId, deviceId, dto);
  }

  @Delete(':id/devices/:deviceId')
  removeDevice(
    @Param('id') doorId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.doorService.removeDevice(doorId, deviceId);
  }

  // ── Sync / Ping ──────────────────────────────────────────────────

  @Post('sync')
  async syncDevices() {
    return this.doorService.pingAllDevices();
  }

  @Post('ping')
  pingAll() {
    return this.doorService.pingAllDevices();
  }

  @Post(':id/discover')
  discoverInfo(@Param('id') id: string) {
    return this.doorService.discoverDeviceInfo(id);
  }

  // ── Per-Device Ping ──────────────────────────────────────────────

  @Post(':id/ping')
  pingDoor(@Param('id') id: string) {
    // Accept either a door ID or device ID — try device first
    return this.doorService.pingDevice(id);
  }

  // ── Device Control Endpoints ─────────────────────────────────────

  @Post(':id/full-info')
  getFullDeviceInfo(@Param('id') id: string) {
    return this.doorService.getFullDeviceInfo(id);
  }

  @Post(':id/time/get')
  getDeviceTime(@Param('id') id: string) {
    return this.doorService.getDeviceTime(id);
  }

  @Post(':id/time/set')
  setDeviceTime(@Param('id') id: string) {
    return this.doorService.setDeviceTime(id);
  }

  @Get(':id/door-state')
  getDoorState(@Param('id') id: string) {
    return this.doorService.getDoorState(id);
  }

  @Post(':id/unlock')
  unlockDoor(@Param('id') id: string) {
    return this.doorService.unlockDoor(id);
  }

  @Post(':id/restart')
  restartDevice(@Param('id') id: string) {
    return this.doorService.restartDevice(id);
  }

  @Post(':id/freeze')
  freezeDevice(@Param('id') id: string) {
    return this.doorService.freezeDevice(id);
  }

  @Post(':id/unfreeze')
  unfreezeDevice(@Param('id') id: string) {
    return this.doorService.unfreezeDevice(id);
  }

  @Post(':id/test-voice')
  testVoice(@Param('id') id: string) {
    return this.doorService.testVoice(id);
  }

  @Post(':id/cancel-alarm')
  cancelAlarm(@Param('id') id: string) {
    return this.doorService.cancelAlarm(id);
  }

  @Post(':id/power-off')
  powerOffDevice(@Param('id') id: string) {
    return this.doorService.powerOffDevice(id);
  }

  @Get(':id/options')
  getDeviceOptions(@Param('id') id: string) {
    return this.doorService.getDeviceOptions(id);
  }

  @Post(':id/options')
  setDeviceOptions(@Param('id') id: string, @Body() body: { data?: string }) {
    return this.doorService.setDeviceOptions(id, body?.data ?? '');
  }

  @Post(':id/sniff')
  sniffDoor(@Param('id') id: string) {
    return this.doorService.sniffDevice(id);
  }

  @Post(':id/sniff/add')
  addSniffedUsers(@Param('id') id: string, @Body() body: { users: { uid: number; userId: string; name: string }[] }) {
    return this.doorService.addSniffedUsers(id, body.users);
  }
}
