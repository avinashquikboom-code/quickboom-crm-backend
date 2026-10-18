import { CustomerModule } from '../customer/customer.module';
import { WorkRecordGuard } from './work-record.guard';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { WorkController } from './work.controller';
import { WorkService } from './work.service';
import { WorkAssignmentService } from './work-assignment.service';
import { PlanScheduleGateway } from './plan-schedule.gateway';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [CustomerModule, PrismaModule, JwtModule.register({}), ConfigModule, NotificationModule],
  controllers: [WorkController],
  providers: [WorkRecordGuard, WorkService, WorkAssignmentService, PlanScheduleGateway],
  exports: [WorkService, WorkAssignmentService, PlanScheduleGateway],
})
export class WorkModule {}

