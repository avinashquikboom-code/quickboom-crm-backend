import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationSettingsModule } from '../integration-settings/integration-settings.module';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [PrismaModule, IntegrationSettingsModule],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
