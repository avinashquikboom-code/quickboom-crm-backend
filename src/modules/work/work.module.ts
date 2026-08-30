import { Module } from '@nestjs/common';
import { WorkController } from './work.controller';
import { WorkService } from './work.service';
import { PlanScheduleGateway } from './plan-schedule.gateway';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WorkController],
  providers: [WorkService, PlanScheduleGateway],
  exports: [WorkService, PlanScheduleGateway],
})
export class WorkModule {}
