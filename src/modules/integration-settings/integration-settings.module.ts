import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationSettingsService } from './integration-settings.service';
import { IntegrationSettingsController } from './integration-settings.controller';
import { PublicSettingsController } from './public-settings.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [IntegrationSettingsController, PublicSettingsController],
  providers: [IntegrationSettingsService],
  exports: [IntegrationSettingsService],
})
export class IntegrationSettingsModule {}
