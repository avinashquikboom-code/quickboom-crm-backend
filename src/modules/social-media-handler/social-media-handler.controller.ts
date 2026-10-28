import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SocialMediaHandlerService } from './social-media-handler.service';
import {
  CreateSocialMediaHandlerDto,
  QuerySocialMediaHandlerDto,
  UpdateSocialMediaHandlerDto,
} from './dto/social-media-handler.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Social Media Handlers')
@Controller()
@UseGuards(JwtAuthGuard, CustomerGuard)
@ApiBearerAuth()
export class SocialMediaHandlerController {
  constructor(private readonly handlerService: SocialMediaHandlerService) {}

  private extractContext(user: any, customerId: any, req: any) {
    const rawCustId =
      customerId ??
      req?.customerId ??
      user?.customerId ??
      req?.headers?.['x-customer-id'];

    const parsedCustomerId = rawCustId
      ? Number(String(rawCustId).replace(/[^0-9]/g, ''))
      : null;

    return {
      id: user?.id ?? 0,
      customerId: parsedCustomerId,
      role: user?.role || (Array.isArray(user?.roles) ? user?.roles.join(',') : 'CUSTOMER'),
      isSuperAdmin: req?.isSuperAdmin || Boolean(user?.roles?.includes('SUPER_ADMIN') || user?.role === 'SUPER_ADMIN'),
      isAdminOrStaff: req?.isAdminOrStaff || Boolean(user?.roles?.includes('COMPANY_ADMIN') || user?.role === 'COMPANY_ADMIN'),
    };
  }

  // ── Customer & Common Endpoints ─────────────────────────────────────────────

  @Get(['social-media-handler', 'social-media-handlers', 'customer/social-media-handler', 'customer/social-media-handlers'])
  @ApiOperation({ summary: 'Get social media handlers for authenticated customer' })
  async getCustomerHandlers(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Query() query: QuerySocialMediaHandlerDto,
  ) {
    const context = this.extractContext(user, customerId, req);
    return this.handlerService.findAll(query, context);
  }

  @Post(['social-media-handler', 'customer/social-media-handler'])
  @ApiOperation({ summary: 'Create a social media handler record' })
  async createHandler(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: CreateSocialMediaHandlerDto,
  ) {
    const context = this.extractContext(user, customerId, req);
    return this.handlerService.create(dto, context);
  }

  @Get(['social-media-handler/:id', 'customer/social-media-handler/:id'])
  @ApiOperation({ summary: 'Get single social media handler by ID' })
  async getHandlerById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const context = this.extractContext(user, customerId, req);
    return this.handlerService.findOne(id, context);
  }

  @Patch(['social-media-handler/:id', 'customer/social-media-handler/:id'])
  @ApiOperation({ summary: 'Update a social media handler record' })
  async updateHandler(
    @Param('id', ParseIntPipe) id: number,
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: UpdateSocialMediaHandlerDto,
  ) {
    const context = this.extractContext(user, customerId, req);
    return this.handlerService.update(id, dto, context);
  }

  @Delete(['social-media-handler/:id', 'customer/social-media-handler/:id'])
  @ApiOperation({ summary: 'Delete a social media handler record' })
  async deleteHandler(
    @Param('id', ParseIntPipe) id: number,
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const context = this.extractContext(user, customerId, req);
    return this.handlerService.remove(id, context);
  }

  // ── Admin Endpoints ─────────────────────────────────────────────────────────

  @Get(['admin/social-media-handler', 'admin/social-media-handlers'])
  @ApiOperation({ summary: 'List all social media handlers across customers (Admin)' })
  async getAllAdminHandlers(
    @CurrentUser() user: any,
    @Req() req: any,
    @Query() query: QuerySocialMediaHandlerDto,
  ) {
    const context = this.extractContext(user, null, req);
    return this.handlerService.findAll(query, context);
  }

  @Get('admin/customers/:customerId/social-media-handler')
  @ApiOperation({ summary: 'Get social media handlers for a specific customer (Admin)' })
  async getAdminCustomerHandlers(
    @Param('customerId') customerId: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Query() query: QuerySocialMediaHandlerDto,
  ) {
    const context = this.extractContext(user, customerId, req);
    return this.handlerService.findAll({ ...query, customerId }, context);
  }

  @Post(['admin/social-media-handler', 'admin/social-media-handlers'])
  @ApiOperation({ summary: 'Create a social media handler for any customer (Admin)' })
  async createAdminHandler(
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: CreateSocialMediaHandlerDto,
  ) {
    const context = this.extractContext(user, dto.customerId, req);
    return this.handlerService.create(dto, context);
  }

  @Patch(['admin/social-media-handler/:id', 'admin/social-media-handlers/:id'])
  @ApiOperation({ summary: 'Update a social media handler (Admin)' })
  async updateAdminHandler(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: UpdateSocialMediaHandlerDto,
  ) {
    const context = this.extractContext(user, null, req);
    return this.handlerService.update(id, dto, context);
  }

  @Delete(['admin/social-media-handler/:id', 'admin/social-media-handlers/:id'])
  @ApiOperation({ summary: 'Delete a social media handler (Admin)' })
  async deleteAdminHandler(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const context = this.extractContext(user, null, req);
    return this.handlerService.remove(id, context);
  }
}
