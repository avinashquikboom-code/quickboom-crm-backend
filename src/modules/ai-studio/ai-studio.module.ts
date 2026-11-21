import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { IntegrationSettingsModule } from '../integration-settings/integration-settings.module';
import { AiStudioController } from './ai-studio.controller';
import { AiProviderService } from './ai-provider.service';
import { AiCreditService } from './ai-credit.service';
import { AiGenerationService } from './ai-generation.service';
import { NexusOrchestratorService } from './nexus-orchestrator.service';

@Module({
  imports: [PrismaModule, S3Module, IntegrationSettingsModule],
  controllers: [AiStudioController],
  providers: [AiProviderService, AiCreditService, AiGenerationService, NexusOrchestratorService],
  exports: [AiCreditService, AiGenerationService, AiProviderService, NexusOrchestratorService],
})
export class AiStudioModule {}
