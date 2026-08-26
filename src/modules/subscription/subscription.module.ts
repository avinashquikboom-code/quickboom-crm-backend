import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PlanAccessService } from './plan-access.service';
import { CustomPlanController } from './custom-plan.controller';
import { CustomPlanService } from './custom-plan.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { WorkModule } from '../work/work.module';

@Module({
  imports: [PrismaModule, ScheduleModule, WorkModule], // ✅ Direct import — no forwardRef needed
  controllers: [SubscriptionController, CustomPlanController],
  providers: [SubscriptionService, PlanAccessService, CustomPlanService],
  exports: [SubscriptionService, PlanAccessService, CustomPlanService],
})
export class SubscriptionModule {}
