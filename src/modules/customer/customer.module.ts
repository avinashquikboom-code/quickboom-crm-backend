import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [PrismaModule, ScheduleModule],
  controllers: [CustomerController],
  providers: [CustomerService],
  exports: [CustomerService],
})
export class CustomerModule {}

