import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BusinessGrowthService } from './business-growth.service';
import {
  CreateCampaignDto,
  QueryCampaignsDto,
  UpdateCampaignBudgetDto,
  UpdateCampaignStatusDto,
  UpdateBusinessProfileDto,
  AddProfilePhotoDto,
  QueryReviewsDto,
  ReplyReviewDto,
  GenerateAiReplyDto,
  UpdateGrowthSettingsDto,
  GoogleOAuthConnectDto,
} from './dto/business-growth.dto';

@ApiTags('Business Growth & Advertising')
@ApiBearerAuth()
@Controller(['business-growth', 'admin/business-growth'])
export class BusinessGrowthController {
  constructor(private readonly service: BusinessGrowthService) {}

  @ApiOperation({ summary: 'Get unified Business Growth overview dashboard data' })
  @Get('overview')
  async getOverview() {
    return this.service.getOverview();
  }

  // ── Google Ads ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get connected Google Ads accounts' })
  @Get('google-ads/accounts')
  async getGoogleAdsAccounts() {
    return this.service.getGoogleAdsAccounts();
  }

  @ApiOperation({ summary: 'Get Google Ads campaigns' })
  @Get('google-ads/campaigns')
  async getCampaigns(@Query() query: QueryCampaignsDto) {
    return this.service.getCampaigns(query);
  }

  @ApiOperation({ summary: 'Create new Google Ads campaign' })
  @Post('google-ads/campaigns')
  async createCampaign(@Body() dto: CreateCampaignDto) {
    return this.service.createCampaign(dto);
  }

  @ApiOperation({ summary: 'Pause / Resume Google Ads campaign' })
  @Patch('google-ads/campaigns/:id/status')
  async updateCampaignStatus(@Param('id') id: string, @Body() dto: UpdateCampaignStatusDto) {
    return this.service.updateCampaignStatus(id, dto);
  }

  @ApiOperation({ summary: 'Update Google Ads campaign budget' })
  @Patch('google-ads/campaigns/:id/budget')
  async updateCampaignBudget(@Param('id') id: string, @Body() dto: UpdateCampaignBudgetDto) {
    return this.service.updateCampaignBudget(id, dto);
  }

  @ApiOperation({ summary: 'Manually synchronize Google Ads data' })
  @Post('google-ads/sync')
  async syncGoogleAds() {
    return this.service.syncGoogleAds();
  }

  // ── Google Business Profile ────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get Google Business Profile details' })
  @Get('business-profile')
  async getBusinessProfile(@Query('locationId') locationId?: string) {
    return this.service.getBusinessProfile(locationId);
  }

  @ApiOperation({ summary: 'Update Google Business Profile details' })
  @Patch('business-profile')
  async updateBusinessProfile(@Body() dto: UpdateBusinessProfileDto) {
    return this.service.updateBusinessProfile(dto);
  }

  @ApiOperation({ summary: 'Add photo to Google Business Profile' })
  @Post('business-profile/photos')
  async addProfilePhoto(@Body() photo: AddProfilePhotoDto) {
    return this.service.addProfilePhoto(photo);
  }

  // ── Reviews & Ratings ──────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get Google Reviews & Ratings with distribution' })
  @Get('reviews')
  async getReviews(@Query() query: QueryReviewsDto) {
    return this.service.getReviews(query);
  }

  @ApiOperation({ summary: 'Publish reply to a Google Review' })
  @Post('reviews/:id/reply')
  async replyToReview(@Param('id') id: string, @Body() dto: ReplyReviewDto) {
    return this.service.replyToReview(id, dto);
  }

  @ApiOperation({ summary: 'Generate AI-assisted response draft for a Google Review' })
  @Post('reviews/:id/generate-ai-reply')
  async generateAiReply(@Param('id') id: string, @Body() dto: GenerateAiReplyDto) {
    return this.service.generateAiReply(id, dto);
  }

  // ── Analytics ──────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get unified Business Growth & Ads Analytics' })
  @Get('analytics')
  async getAnalytics(@Query('dateRange') dateRange?: string) {
    return this.service.getAnalytics(dateRange);
  }

  // ── Settings & OAuth ───────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get Business Growth integration settings & OAuth status' })
  @Get('settings')
  async getSettings() {
    return this.service.getSettings();
  }

  @ApiOperation({ summary: 'Update Business Growth settings' })
  @Patch('settings')
  async updateSettings(@Body() dto: UpdateGrowthSettingsDto) {
    return this.service.updateSettings(dto);
  }

  @ApiOperation({ summary: 'Connect Google OAuth integration' })
  @Post('google/oauth/connect')
  async connectGoogleOAuth(@Body() dto: GoogleOAuthConnectDto) {
    return this.service.connectGoogleOAuth(dto.provider);
  }

  @ApiOperation({ summary: 'Disconnect Google OAuth integration' })
  @Post('google/oauth/disconnect')
  async disconnectGoogleOAuth(@Body() dto: GoogleOAuthConnectDto) {
    return this.service.disconnectGoogleOAuth(dto.provider);
  }
}
