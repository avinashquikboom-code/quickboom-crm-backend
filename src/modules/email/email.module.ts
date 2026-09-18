import { Module, Global } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationSettingsModule } from '../integration-settings/integration-settings.module';

@Global()
@Module({
  imports: [PrismaModule, IntegrationSettingsModule],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
