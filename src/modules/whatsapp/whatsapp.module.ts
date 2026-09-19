import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationSettingsModule } from '../integration-settings/integration-settings.module';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [PrismaModule, IntegrationSettingsModule],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
