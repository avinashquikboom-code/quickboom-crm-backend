import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PlanAccessService } from './plan-access.service';
import { CustomPlanController } from './custom-plan.controller';
import { CustomPlanService } from './custom-plan.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { WorkModule } from '../work/work.module';

import { InstallmentService } from './installment.service';

@Module({
  imports: [PrismaModule, ScheduleModule, WorkModule], // ✅ Direct import — no forwardRef needed
  controllers: [SubscriptionController, CustomPlanController],
  providers: [SubscriptionService, PlanAccessService, CustomPlanService, InstallmentService],
  exports: [SubscriptionService, PlanAccessService, CustomPlanService, InstallmentService],
})
export class SubscriptionModule {}
