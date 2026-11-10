import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  UseGuards,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { GeneralSettingsService } from './general-settings.service';
import { UpdateGeneralSettingsDto } from './dto/general-settings.dto';
import { S3Service } from '../s3/s3.service';

@ApiTags('Admin General Settings')
@Controller('admin/settings/general')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GeneralSettingsController {
  private readonly logger = new Logger(GeneralSettingsController.name);

  constructor(
    private readonly generalSettingsService: GeneralSettingsService,
    private readonly s3Service: S3Service,
  ) {}

  private checkAdminAccess(user: any) {
    if (isUserSuperAdmin(user)) return;

    const userRoles: string[] = Array.isArray(user?.roles)
      ? user.roles.map((r: any) => String(r).toUpperCase().replace(/[\s_]+/g, ''))
      : user?.role
      ? [String(user.role).toUpperCase().replace(/[\s_]+/g, '')]
      : [];

    const isCompanyAdmin = userRoles.some(
      (r) =>
        r === 'SUPERADMIN' ||
        r === 'COMPANYADMIN' ||
        r === 'CUSTOMERADMIN' ||
        r === 'TENANTADMIN' ||
        r === 'ADMIN',
    );

    if (!isCompanyAdmin) {
      throw new ForbiddenException(
        'Access denied: Only Administrators can view or manage general settings',
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'Fetch general application settings' })
  async getSettings(@CurrentUser() user: any) {
    this.checkAdminAccess(user);
    return this.generalSettingsService.getSettings();
  }

  @Put()
  @ApiOperation({ summary: 'Update general application settings' })
  async updateSettings(
    @CurrentUser() user: any,
    @Body() dto: UpdateGeneralSettingsDto,
  ) {
    this.checkAdminAccess(user);
    return this.generalSettingsService.updateSettings(dto, user?.id);
  }

  @Get('options')
  @ApiOperation({ summary: 'Fetch supported options for languages, currencies, timezones, and formats' })
  async getOptions(@CurrentUser() user: any) {
    this.checkAdminAccess(user);
    return this.generalSettingsService.getOptions();
  }

  @Post('logo')
  @ApiOperation({ summary: 'Upload application logo' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  )
  async uploadLogo(
    @CurrentUser() user: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    this.checkAdminAccess(user);

    if (!file) {
      throw new BadRequestException('Logo image file is required');
    }

    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/svg+xml',
    ];
    if (!allowedMimes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException(
        'Invalid logo format. Supported formats: JPG, JPEG, PNG, SVG, WEBP',
      );
    }

    let logoUrl: string;

    try {
      // Try S3 upload if configured
      const s3Result = await this.s3Service.uploadFile(file, 'general/logos');
      logoUrl = s3Result.imageUrl;
    } catch (s3Error: any) {
      this.logger.warn(
        `[GENERAL_SETTINGS] S3 upload failed or not configured, saving logo locally: ${s3Error?.message}`,
      );

      // Local fallback to public /uploads/logos directory
      const uploadsDir = path.join(process.cwd(), 'uploads', 'logos');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const ext = path.extname(file.originalname) || '.png';
      const filename = `logo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const filePath = path.join(uploadsDir, filename);

      fs.writeFileSync(filePath, file.buffer);
      logoUrl = `/uploads/logos/${filename}`;
    }

    return this.generalSettingsService.updateLogo(logoUrl, user?.id);
  }

  @Delete('logo')
  @ApiOperation({ summary: 'Remove application logo' })
  async removeLogo(@CurrentUser() user: any) {
    this.checkAdminAccess(user);
    return this.generalSettingsService.removeLogo(user?.id);
  }

  @Post('cache/clear')
  @ApiOperation({ summary: 'Clear application configuration cache' })
  async clearCache(@CurrentUser() user: any) {
    this.checkAdminAccess(user);
    return this.generalSettingsService.clearCache();
  }

  @Post('sync')
  @ApiOperation({ summary: 'Synchronize system settings' })
  async syncSettings(@CurrentUser() user: any) {
    this.checkAdminAccess(user);
    return this.generalSettingsService.syncSettings(user?.id);
  }
}

