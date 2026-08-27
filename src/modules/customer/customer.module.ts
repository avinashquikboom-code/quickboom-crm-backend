import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { WorkModule } from '../work/work.module';
import { QBIdGenerator } from '../auth/qb-id.generator';

@Module({
  imports: [PrismaModule, ScheduleModule, WorkModule],
  controllers: [CustomerController],
  providers: [CustomerService, QBIdGenerator],
  exports: [CustomerService],
})
export class CustomerModule {}

