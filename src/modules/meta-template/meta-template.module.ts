import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationSettingsModule } from '../integration-settings/integration-settings.module';
import { MetaTemplateController } from './meta-template.controller';
import { MetaTemplateService } from './meta-template.service';

@Module({
  imports: [PrismaModule, IntegrationSettingsModule],
  controllers: [MetaTemplateController],
  providers: [MetaTemplateService],
  exports: [MetaTemplateService],
})
export class MetaTemplateModule {}
