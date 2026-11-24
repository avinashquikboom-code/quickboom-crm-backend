import { Module } from '@nestjs/common';
import { S3Module } from '../s3/s3.module';
import { MetaTemplateMediaService } from './meta-template-media.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationSettingsModule } from '../integration-settings/integration-settings.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MetaTemplateController } from './meta-template.controller';
import { MetaTemplateService } from './meta-template.service';
import { WhatsAppCampaignController } from './whatsapp-campaign.controller';
import { WhatsAppCampaignService } from './whatsapp-campaign.service';

@Module({
  imports: [PrismaModule, IntegrationSettingsModule, WhatsappModule, S3Module],
  // Campaign controller must register before MetaTemplateController so
  // GET /templates/meta/campaigns is not captured by @Get(':id').
  controllers: [WhatsAppCampaignController, MetaTemplateController],
  providers: [MetaTemplateService, WhatsAppCampaignService, MetaTemplateMediaService],
  exports: [MetaTemplateService, WhatsAppCampaignService],
})
export class MetaTemplateModule {}

