import { Module, forwardRef } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadController } from './lead.controller';
import { LeadRepository } from './lead.repository';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { LeadLimitModule } from '../lead-limit/lead-limit.module';

@Module({
  imports: [SubscriptionModule, PrismaModule, forwardRef(() => LeadLimitModule)],
  controllers: [LeadController],
  providers: [LeadService, LeadRepository],
  exports: [LeadService, LeadRepository],
})
export class LeadModule {}
