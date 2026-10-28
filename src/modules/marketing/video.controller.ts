import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { VideoService } from './video.service';
import {
  CreateMarketingVideoDto,
  QueryMarketingVideoDto,
  UpdateMarketingVideoDto,
  UpdateVideoPublishDto,
  UpdateVideoStatusDto,
} from './dto/video.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Marketing Videos')
@Controller()
export class VideoController {
  private readonly logger = new Logger(VideoController.name);

  constructor(private readonly videoService: VideoService) {}

  private checkCompanyAdminAccess(user: any) {
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
        'Access denied: Only Company Administrators can manage marketing videos',
      );
    }
  }

  private resolveCustomerContext(
    customerId: any,
    user: any,
    headerCustomerId?: string,
    req?: any,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    let parsedCustomerId: number | null = null;

    const rawCustId =
      customerId ??
      headerCustomerId ??
      req?.headers?.['x-customer-id'] ??
      req?.customerId ??
      user?.customerId ??
      (user?.role === 'CUSTOMER' ? (user?.customerId || user?.id) : undefined);

    if (typeof rawCustId === 'number' && !isNaN(rawCustId)) {
      parsedCustomerId = rawCustId;
    } else if (rawCustId && rawCustId !== 'ALL' && rawCustId !== 'undefined') {
      const num = parseInt(String(rawCustId).replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) {
        parsedCustomerId = num;
      }
    }

    return {
      id: user?.id ?? 0,
      customerId: isSuperAdmin ? (headerCustomerId || req?.query?.customerId ? parsedCustomerId : null) : parsedCustomerId,
      role: user?.role,
      isSuperAdmin,
    };
  }

  // ── Company Admin Endpoints ─────────────────────────────────────────────────

  @Post('admin/marketing/videos')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Create a new marketing video with optional video and thumbnail uploads' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'video', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ]),
  )
  async create(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateMarketingVideoDto,
    @UploadedFiles()
    files?: {
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.videoService.create(dto, context, files);
  }

  @Get('admin/marketing/videos')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'List all marketing videos (Company Admin / Super Admin)' })
  async findAllAdmin(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query() query: QueryMarketingVideoDto,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.videoService.findAllAdmin(query, context);
  }

  @Get('admin/marketing/videos/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Get marketing video by ID' })
  async findOne(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.videoService.findOne(id, context);
  }

  @Patch('admin/marketing/videos/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Update marketing video' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'video', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ]),
  )
  async update(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMarketingVideoDto,
    @UploadedFiles()
    files?: {
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.videoService.update(id, dto, context, files);
  }

  @Delete('admin/marketing/videos/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Soft delete marketing video' })
  async remove(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.videoService.remove(id, context);
  }

  @Patch('admin/marketing/videos/:id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Toggle/set video status or active flag' })
  async setStatus(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVideoStatusDto,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.videoService.setStatus(id, dto.isActive, dto.status, context);
  }

  @Patch('admin/marketing/videos/:id/publish')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Toggle/set video published flag' })
  async setPublished(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVideoPublishDto,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.videoService.setPublished(id, dto.isPublished, context);
  }

  @Post('admin/marketing/videos/:id/reset-views')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Reset customer view records for this marketing video (Company Admin)' })
  async resetViews(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.videoService.resetIntroductionViews(id, context);
  }

  @Get('admin/marketing/videos/:id/playback-url')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Get a fresh 7-day presigned playback URL for a marketing video (Admin preview)' })
  async getPlaybackUrl(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.videoService.getPlaybackUrl(id, context);
  }

  // ── Customer Endpoints ──────────────────────────────────────────────────────

  @Get(['customer/marketing/videos', 'marketing/videos'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Get active, customer-visible marketing videos for Customer Home Screen' })
  async getCustomerVideos(
    @CurrentUser() user: any,
    @Req() req: any,
    @CurrentCustomer() customerId?: string,
    @Headers('x-customer-id') headerCustomerId?: string,
  ) {
    const context = this.resolveCustomerContext(customerId, user, headerCustomerId, req);
    return this.videoService.findAllCustomer(context);
  }

  @Get(['customer/marketing/introduction-video', 'marketing/introduction-video'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Get next eligible unseen marketing video for Customer Introduction / Onboarding' })
  async getCustomerIntroductionVideo(
    @CurrentUser() user: any,
    @Req() req: any,
    @CurrentCustomer() customerId?: string,
    @Headers('x-customer-id') headerCustomerId?: string,
  ) {
    const context = this.resolveCustomerContext(customerId, user, headerCustomerId, req);
    return this.videoService.findIntroductionVideoCustomer(context);
  }

  @Post(['customer/marketing/introduction-video/:id/seen', 'marketing/introduction-video/:id/seen'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Mark an introduction marketing video as seen/skipped for authenticated customer' })
  async markIntroductionVideoSeen(
    @CurrentUser() user: any,
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @CurrentCustomer() customerId?: string,
    @Headers('x-customer-id') headerCustomerId?: string,
  ) {
    const context = this.resolveCustomerContext(customerId, user, headerCustomerId, req);
    return this.videoService.markIntroductionVideoSeen(id, context);
  }
}
