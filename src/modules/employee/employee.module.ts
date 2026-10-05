import { Module } from '@nestjs/common';
import { EmployeeController, PermissionsController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { WorkModule } from '../work/work.module';

@Module({
  imports: [PrismaModule, SubscriptionModule, WorkModule],
  controllers: [EmployeeController, PermissionsController],
  providers: [EmployeeService],
  exports: [EmployeeService],
})
export class EmployeeModule {}
