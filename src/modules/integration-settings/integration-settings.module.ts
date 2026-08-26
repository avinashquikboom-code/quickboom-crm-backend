import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationSettingsService } from './integration-settings.service';
import { IntegrationSettingsController } from './integration-settings.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [IntegrationSettingsController],
  providers: [IntegrationSettingsService],
  exports: [IntegrationSettingsService],
})
export class IntegrationSettingsModule {}
