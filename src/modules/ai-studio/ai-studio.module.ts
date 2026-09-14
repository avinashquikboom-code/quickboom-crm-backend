import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { AiStudioController } from './ai-studio.controller';
import { AiProviderService } from './ai-provider.service';
import { AiCreditService } from './ai-credit.service';
import { AiGenerationService } from './ai-generation.service';

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [AiStudioController],
  providers: [AiProviderService, AiCreditService, AiGenerationService],
  exports: [AiCreditService, AiGenerationService, AiProviderService],
})
export class AiStudioModule {}
