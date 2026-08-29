import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { BannerService } from './banner.service';
import {
  CreateMarketingBannerDto,
  QueryMarketingBannerDto,
  UpdateBannerPublishDto,
  UpdateBannerStatusDto,
  UpdateMarketingBannerDto,
} from './dto/banner.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Marketing Banners')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller()
export class BannerController {
  constructor(private readonly bannerService: BannerService) {}

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
        'Access denied: Only Company Administrators can manage marketing banners',
      );
    }
  }

  private resolveCustomerContext(customerId: any, user: any) {
    const isSuperAdmin = isUserSuperAdmin(user);
    let parsedCustomerId: number | null = null;

    if (typeof customerId === 'number' && !isNaN(customerId)) {
      parsedCustomerId = customerId;
    } else if (customerId && customerId !== 'ALL' && customerId !== 'undefined') {
      const num = parseInt(String(customerId), 10);
      if (!isNaN(num)) {
        parsedCustomerId = num;
      }
    }

    if (parsedCustomerId === null && user?.customerId) {
      if (typeof user.customerId === 'number' && !isNaN(user.customerId)) {
        parsedCustomerId = user.customerId;
      } else {
        const num = parseInt(String(user.customerId), 10);
        if (!isNaN(num)) {
          parsedCustomerId = num;
        }
      }
    }

    return {
      id: user?.id ?? 0,
      customerId: isSuperAdmin && !customerId ? null : parsedCustomerId,
      role: user?.role,
    };
  }

  // ── Company Admin Endpoints ─────────────────────────────────────────────────

  @Post('admin/marketing/banners')
  @ApiOperation({ summary: 'Create a new marketing banner with file upload (Company Admin only)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('image'))
  async create(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateMarketingBannerDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.bannerService.create(dto, context, file);
  }

  @Get('admin/marketing/banners')
  @ApiOperation({ summary: 'List all banners with filter & pagination (Company Admin)' })
  async findAllAdmin(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query() query: QueryMarketingBannerDto,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.bannerService.findAllAdmin(query, context);
  }

  @Get('admin/marketing/banners/:id')
  @ApiOperation({ summary: 'Get banner by ID' })
  async findOne(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.bannerService.findOne(id, context);
  }

  @Patch('admin/marketing/banners/:id')
  @ApiOperation({ summary: 'Update marketing banner with optional image replace (Company Admin only)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('image'))
  async update(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMarketingBannerDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.bannerService.update(id, dto, context, file);
  }

  @Delete('admin/marketing/banners/:id')
  @ApiOperation({ summary: 'Soft delete marketing banner (Company Admin only)' })
  async remove(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.bannerService.remove(id, context);
  }

  @Patch('admin/marketing/banners/:id/publish')
  @ApiOperation({ summary: 'Toggle/set banner publish status (Company Admin only)' })
  async setPublished(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBannerPublishDto,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.bannerService.setPublished(id, dto.isPublished, context);
  }

  @Patch('admin/marketing/banners/:id/status')
  @ApiOperation({ summary: 'Toggle/set banner active status (Company Admin only)' })
  async setStatus(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBannerStatusDto,
  ) {
    this.checkCompanyAdminAccess(user);
    const context = this.resolveCustomerContext(customerId, user);
    return this.bannerService.setStatus(id, dto.isActive, context);
  }

  // ── Customer Endpoints ──────────────────────────────────────────────────────

  @Get('customer/marketing/banners')
  @ApiOperation({ summary: 'Get active, published home banners for Customer Home Screen' })
  async getCustomerBanners(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
  ) {
    const context = this.resolveCustomerContext(customerId, user);
    return this.bannerService.findAllCustomer(context);
  }
}
