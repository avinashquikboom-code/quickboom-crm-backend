import { Module, Global } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { EmailTemplateService } from './email-template.service';
import { EmailTemplateController } from './email-template.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationSettingsModule } from '../integration-settings/integration-settings.module';

@Global()
@Module({
  imports: [PrismaModule, IntegrationSettingsModule],
  controllers: [EmailController, EmailTemplateController],
  providers: [EmailService, EmailTemplateService],
  exports: [EmailService, EmailTemplateService],
})
export class EmailModule {}
