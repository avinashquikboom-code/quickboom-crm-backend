import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { QBIdGenerator } from '../auth/qb-id.generator';

@Module({
  imports: [PrismaModule, ScheduleModule],
  controllers: [CustomerController],
  providers: [CustomerService, QBIdGenerator],
  exports: [CustomerService],
})
export class CustomerModule {}

