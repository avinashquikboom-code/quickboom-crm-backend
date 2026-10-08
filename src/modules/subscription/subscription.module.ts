import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PlanAccessService } from './plan-access.service';
import { CustomPlanController } from './custom-plan.controller';
import { CustomPlanService } from './custom-plan.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { WorkModule } from '../work/work.module';
import { NotificationModule } from '../notification/notification.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { InstallmentService } from './installment.service';
import { CommissionModule } from '../commission/commission.module';
import { CouponModule } from './coupon.module';

@Module({
  imports: [PrismaModule, ScheduleModule, WorkModule, NotificationModule, WhatsappModule, InvoiceModule, CommissionModule, CouponModule],
  controllers: [SubscriptionController, CustomPlanController],
  providers: [SubscriptionService, PlanAccessService, CustomPlanService, InstallmentService],
  exports: [SubscriptionService, PlanAccessService, CustomPlanService, InstallmentService],
})
export class SubscriptionModule {}
