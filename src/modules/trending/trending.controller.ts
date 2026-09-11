import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { TrendingService } from './trending.service';
import {
  CreateTrendingContentDto,
  UpdateTrendingContentDto,
  QueryTrendingDto,
  UpdatePublishStatusDto,
  UpdateActiveStatusDto,
} from './dto/trending.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TrendingCategory } from '@prisma/client';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Trending Content')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller()
export class TrendingController {
  constructor(private readonly trendingService: TrendingService) {}

  private checkCompanyAdminAccess(user: any) {
    if (isUserSuperAdmin(user)) return;

    const userRoles: string[] = Array.isArray(user?.roles)
      ? user.roles.map((r: any) => String(r).toUpperCase().replace(/[\s_]+/g, ''))
      : (user?.role ? [String(user.role).toUpperCase().replace(/[\s_]+/g, '')] : []);

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
        'Access denied: Only Company Administrators can manage trending content',
      );
    }
  }

  // ── Company Admin Endpoints ─────────────────────────────────────────────────

  @Post(['admin/trending', 'admin/marketing/trending'])
  @ApiOperation({ summary: 'Create new trending content item(s) with optional file upload (Company Admin only)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(AnyFilesInterceptor())
  async create(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateTrendingContentDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    this.checkCompanyAdminAccess(user);
    const isSuperAdmin = isUserSuperAdmin(user);
    return this.trendingService.create(customerId, user?.id, dto, isSuperAdmin, files);
  }

  @Get(['admin/trending', 'admin/marketing/trending'])
  @ApiOperation({ summary: 'List trending content for Admin with filters and pagination' })
  async findAllAdmin(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query() query: QueryTrendingDto,
  ) {
    this.checkCompanyAdminAccess(user);
    const isSuperAdmin = isUserSuperAdmin(user);
    return this.trendingService.findAllAdmin(customerId, query, isSuperAdmin);
  }

  @Get(['admin/trending/:id', 'admin/marketing/trending/:id'])
  @ApiOperation({ summary: 'Get single trending content details (Company Admin only)' })
  async findOne(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    this.checkCompanyAdminAccess(user);
    const isSuperAdmin = isUserSuperAdmin(user);
    return this.trendingService.findOne(customerId, id, isSuperAdmin);
  }

  @Patch(['admin/trending/:id', 'admin/marketing/trending/:id'])
  @ApiOperation({ summary: 'Update trending content with optional file upload (Company Admin only)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('file'))
  async update(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateTrendingContentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    this.checkCompanyAdminAccess(user);
    const isSuperAdmin = isUserSuperAdmin(user);
    return this.trendingService.update(customerId, id, dto, isSuperAdmin, file);
  }

  @Delete(['admin/trending/:id', 'admin/marketing/trending/:id'])
  @ApiOperation({ summary: 'Delete trending content (Company Admin only)' })
  async remove(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    this.checkCompanyAdminAccess(user);
    const isSuperAdmin = isUserSuperAdmin(user);
    return this.trendingService.remove(customerId, id, isSuperAdmin);
  }

  @Patch(['admin/trending/:id/publish', 'admin/marketing/trending/:id/publish'])
  @ApiOperation({ summary: 'Publish or unpublish trending content (Company Admin only)' })
  async setPublished(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdatePublishStatusDto,
  ) {
    this.checkCompanyAdminAccess(user);
    const isSuperAdmin = isUserSuperAdmin(user);
    return this.trendingService.setPublished(customerId, id, dto.isPublished, isSuperAdmin);
  }

  @Patch(['admin/trending/:id/status', 'admin/marketing/trending/:id/status'])
  @ApiOperation({ summary: 'Set active/inactive status for trending content (Company Admin only)' })
  async setStatus(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateActiveStatusDto,
  ) {
    this.checkCompanyAdminAccess(user);
    const isSuperAdmin = isUserSuperAdmin(user);
    return this.trendingService.setStatus(customerId, id, dto.isActive, isSuperAdmin);
  }

  // ── Customer Endpoint ───────────────────────────────────────────────────────

  @Get(['customer/trending', 'customer/marketing/trending'])
  @ApiOperation({ summary: 'Get active published trending content for customer' })
  @ApiQuery({ name: 'category', enum: TrendingCategory, required: false })
  @ApiQuery({ name: 'platform', type: String, required: false })
  @ApiQuery({ name: 'sort', type: String, required: false })
  async findAllCustomer(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query('category') category?: TrendingCategory,
    @Query('platform') platform?: string,
    @Query('sort') sort?: string,
  ) {
    return this.trendingService.findAllCustomer(customerId, category, user, platform, sort);
  }

  @Get('trending')
  @ApiOperation({ summary: 'Alias: Get active published trending content' })
  @ApiQuery({ name: 'category', enum: TrendingCategory, required: false })
  @ApiQuery({ name: 'platform', type: String, required: false })
  @ApiQuery({ name: 'sort', type: String, required: false })
  async findAllTrendingAlias(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query('category') category?: TrendingCategory,
    @Query('platform') platform?: string,
    @Query('sort') sort?: string,
  ) {
    return this.trendingService.findAllCustomer(customerId, category, user, platform, sort);
  }
}
