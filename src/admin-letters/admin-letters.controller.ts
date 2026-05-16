import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Response } from 'express';
import { AdminLettersService } from './admin-letters.service';
import { CreateAdminLetterDto } from './dto/create-admin-letter.dto';
import { UpdateAdminLetterDto } from './dto/update-admin-letter.dto';
import { AddLetterPersonDto } from './dto/add-letter-person.dto';
import { PermissionsGuard } from '../common/permissions/permissions.guard';
import { RequirePermissions } from '../common/permissions/require-permissions.decorator';
import * as path from 'path';
import * as crypto from 'crypto';

@Controller('admin-letters')
@UseGuards(PermissionsGuard)
@RequirePermissions('ACCESS_CONTROL')
export class AdminLettersController {
  constructor(private readonly service: AdminLettersService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      search,
    });
  }

  @Get('by-person')
  findByPerson(
    @Query('personType') personType: string,
    @Query('personId') personId: string,
  ) {
    if (!personType || !personId) {
      throw new BadRequestException('personType and personId are required');
    }
    return this.service.findByPerson(personType, Number(personId));
  }

  @Get('by-person-name')
  findByPersonName(
    @Query('personType') personType: string,
    @Query('personName') personName: string,
  ) {
    if (!personType || !personName) {
      throw new BadRequestException('personType and personName are required');
    }
    return this.service.findByPersonName(personType, personName);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const letter = await this.service.findOne(id);
    if (!letter) throw new NotFoundException('Letter not found');
    return letter;
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: path.join(process.cwd(), 'uploads', 'admin-letters'),
        filename: (_req, file, cb) => {
          const uniqueId = crypto.randomBytes(16).toString('hex');
          const ext = path.extname(file.originalname);
          cb(null, `${uniqueId}${ext}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif'];
        if (allowed.includes(ext)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only PDF and image files are allowed (jpg, png, webp, gif)'), false);
        }
      },
    }),
  )
  async create(
    @Body() dto: CreateAdminLetterDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return this.service.create(dto, file);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAdminLetterDto) {
    const letter = await this.service.update(id, dto);
    if (!letter) throw new NotFoundException('Letter not found');
    return letter;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const result = await this.service.remove(id);
    if (!result) throw new NotFoundException('Letter not found');
    return { success: true };
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const letter = await this.service.findOne(id);
    if (!letter) throw new NotFoundException('Letter not found');

    const fullPath = path.resolve(letter.pdfPath);
    const ext = path.extname(letter.originalFileName).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(letter.originalFileName)}"`,
    );
    res.sendFile(fullPath);
  }

  @Get(':id/persons')
  getPersons(@Param('id') id: string) {
    return this.service.getPersons(id);
  }

  @Post(':id/persons')
  addPerson(@Param('id') id: string, @Body() dto: AddLetterPersonDto) {
    return this.service.addPerson(id, dto);
  }

  @Delete(':id/persons/:personLinkId')
  async removePerson(
    @Param('id') id: string,
    @Param('personLinkId') personLinkId: string,
  ) {
    await this.service.removePerson(id, personLinkId);
    return { success: true };
  }

  @Patch(':id/persons/:personLinkId/toggle-access')
  async togglePersonAccess(
    @Param('id') id: string,
    @Param('personLinkId') personLinkId: string,
  ) {
    return this.service.togglePersonAccess(personLinkId);
  }

  @Patch(':id/toggle-all-access')
  async bulkToggleAccess(
    @Param('id') id: string,
    @Body() body: { activate: boolean },
  ) {
    return this.service.bulkToggleAccess(id, body.activate);
  }
}
