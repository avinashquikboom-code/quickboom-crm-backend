import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PlanAccessService } from './plan-access.service';
import { CustomPlanController } from './custom-plan.controller';
import { CustomPlanService } from './custom-plan.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [PrismaModule, ScheduleModule],
  controllers: [SubscriptionController, CustomPlanController],
  providers: [SubscriptionService, PlanAccessService, CustomPlanService],
  exports: [SubscriptionService, PlanAccessService, CustomPlanService],
})
export class SubscriptionModule {}

