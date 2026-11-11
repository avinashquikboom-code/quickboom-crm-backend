import { Module, forwardRef } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadController } from './lead.controller';
import { LeadRepository } from './lead.repository';
import { VisitorLeadActionsGuard } from './visitor-lead-actions.guard';
import { CrmEmployeeAccessGuard } from '../../common/guards/crm-employee-access.guard';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { LeadLimitModule } from '../lead-limit/lead-limit.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { S3Module } from '../s3/s3.module';
import { SendDetailsModule } from '../send-details/send-details.module';

@Module({
  imports: [
    SubscriptionModule,
    PrismaModule,
    forwardRef(() => LeadLimitModule),
    WhatsappModule,
    S3Module,
    forwardRef(() => SendDetailsModule),
  ],
  controllers: [LeadController],
  providers: [LeadService, LeadRepository, VisitorLeadActionsGuard, CrmEmployeeAccessGuard],
  exports: [LeadService, LeadRepository],
})
export class LeadModule {}
