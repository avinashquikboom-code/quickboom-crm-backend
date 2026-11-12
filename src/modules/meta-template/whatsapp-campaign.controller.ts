import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WhatsAppCampaignService } from './whatsapp-campaign.service';
import { CreateWhatsAppCampaignDto, QueryWhatsAppCampaignDto } from './dto/whatsapp-campaign.dto';

@ApiTags('WhatsApp Campaigns')
// Primary routes live on MetaTemplateController (@Get('campaigns') before :id).
// Alias path for integrations that mount campaigns separately.
@Controller('whatsapp/campaigns')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WhatsAppCampaignController {
  constructor(private readonly campaignService: WhatsAppCampaignService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Campaign dashboard metrics' })
  getStats(@CurrentUser() user: any) {
    return this.campaignService.getStats(user?.customerId);
  }

  @Get()
  @ApiOperation({ summary: 'List WhatsApp messaging campaigns' })
  findAll(@CurrentUser() user: any, @Query() query: QueryWhatsAppCampaignDto) {
    return this.campaignService.findAll(user?.customerId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get campaign with delivery details' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.campaignService.findOne(id, user?.customerId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a WhatsApp campaign (draft or scheduled)' })
  create(@Body() dto: CreateWhatsAppCampaignDto, @CurrentUser() user: any) {
    return this.campaignService.create(dto, user?.customerId, user?.id);
  }

  @Post(':id/launch')
  @ApiOperation({ summary: 'Launch campaign sending via WhatsApp Cloud API' })
  launch(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.campaignService.launch(id, user?.customerId);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a draft or scheduled campaign' })
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.campaignService.cancel(id, user?.customerId);
  }
}
