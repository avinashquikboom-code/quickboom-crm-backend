import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SocialAccountService } from './social-account.service';
import { SocialPublishService } from './social-publish.service';
import { ConnectSocialAccountDto, PublishContentDto } from './dto/social-publishing.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Social Publishing')
@Controller()
export class SocialPublishingController {
  constructor(
    private readonly socialAccountService: SocialAccountService,
    private readonly socialPublishService: SocialPublishService,
  ) {}

  private resolveCustomerId(req: any): number {
    const user = req.user;
    const rawId =
      user?.customerId ??
      (user?.role === 'CUSTOMER' ? user?.customerId || user?.id : undefined) ??
      req.headers?.['x-customer-id'];
    const parsed = parseInt(String(rawId), 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new ForbiddenException('Valid customer authentication session is required');
    }
    return parsed;
  }

  // =========================================================================
  // CUSTOMER SOCIAL ACCOUNTS APIS
  // =========================================================================

  @Get(['social/accounts', 'customer/social/accounts'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get all connected social accounts for logged-in customer' })
  async getAccounts(@Req() req: any) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.socialAccountService.getAccounts(customerId);
    return { statusCode: 200, success: true, data };
  }

  @Post(['social/accounts/connect', 'customer/social/accounts/connect', 'social/connect', 'customer/social/connect'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Connect social media account (Instagram, Facebook, YouTube, LinkedIn, TikTok)' })
  async connectAccount(@Req() req: any, @Body() dto: ConnectSocialAccountDto) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.socialAccountService.connectAccount(customerId, dto);
    return {
      statusCode: 201,
      success: true,
      message: `${dto.platform} account connected successfully`,
      data,
    };
  }

  @Post(['social/accounts/:id/disconnect', 'customer/social/accounts/:id/disconnect', 'social/disconnect/:id', 'customer/social/disconnect/:id'])
  @Delete(['social/accounts/:id', 'customer/social/accounts/:id'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Disconnect a social media account' })
  async disconnectAccount(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.socialAccountService.disconnectAccount(customerId, id);
    return {
      statusCode: 200,
      success: true,
      message: 'Account disconnected successfully',
      data,
    };
  }

  // =========================================================================
  // CUSTOMER PUBLISHING & SCHEDULING APIS
  // =========================================================================

  @Post(['social/publish', 'customer/social/publish'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Publish or schedule post across connected social media accounts' })
  async publishContent(@Req() req: any, @Body() dto: PublishContentDto) {
    const customerId = this.resolveCustomerId(req);
    const result = await this.socialPublishService.publishOrSchedule(customerId, dto);
    return {
      statusCode: 201,
      success: true,
      message: result.mode === 'SCHEDULED' ? 'Post scheduled successfully' : 'Content published successfully',
      ...result,
    };
  }

  @Get(['social/publishes', 'customer/social/publishes'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get publishing history and scheduled queue for logged-in customer' })
  async getMyPublishes(@Req() req: any, @Query('status') status?: string) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.socialPublishService.getMyPublishes(customerId, status);
    return { statusCode: 200, success: true, data };
  }

  @Delete(['social/publishes/:id', 'customer/social/publishes/:id'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel a scheduled post' })
  async cancelScheduledPost(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const customerId = this.resolveCustomerId(req);
    const data = await this.socialPublishService.cancelScheduledPost(customerId, id);
    return {
      statusCode: 200,
      success: true,
      message: 'Scheduled post cancelled',
      data,
    };
  }

  // =========================================================================
  // ADMIN PANEL APIS
  // =========================================================================

  @Get('admin/social/accounts')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'View all customer connected social accounts (Admin)' })
  async getAllAccountsAdmin(@Query() query: any) {
    const data = await this.socialAccountService.getAllAccountsAdmin(query);
    return { statusCode: 200, success: true, data };
  }

  @Get('admin/social/publishes')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'View all published and scheduled posts across customers (Admin)' })
  async getAllPublishesAdmin(@Query() query: any) {
    const data = await this.socialPublishService.getAllPublishesAdmin(query);
    return { statusCode: 200, success: true, data };
  }
}
