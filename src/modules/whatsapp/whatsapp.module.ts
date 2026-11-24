import { Module } from '@nestjs/common';
import { S3Module } from '../s3/s3.module';
import { MetaTemplateMediaService } from '../meta-template/meta-template-media.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationSettingsModule } from '../integration-settings/integration-settings.module';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [PrismaModule, IntegrationSettingsModule, S3Module],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappService, MetaTemplateMediaService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
