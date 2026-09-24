import { Module, forwardRef } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadController } from './lead.controller';
import { LeadRepository } from './lead.repository';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { LeadLimitModule } from '../lead-limit/lead-limit.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [SubscriptionModule, PrismaModule, forwardRef(() => LeadLimitModule), WhatsappModule, S3Module],
  controllers: [LeadController],
  providers: [LeadService, LeadRepository],
  exports: [LeadService, LeadRepository],
})
export class LeadModule {}
