import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { WorkController } from './work.controller';
import { WorkService } from './work.service';
import { PlanScheduleGateway } from './plan-schedule.gateway';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, JwtModule.register({}), ConfigModule],
  controllers: [WorkController],
  providers: [WorkService, PlanScheduleGateway],
  exports: [WorkService, PlanScheduleGateway],
})
export class WorkModule {}
