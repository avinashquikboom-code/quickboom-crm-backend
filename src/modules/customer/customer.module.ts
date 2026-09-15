import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { ShowcaseController } from './showcase.controller';
import { ShowcaseService } from './showcase.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { WorkModule } from '../work/work.module';
import { AiStudioModule } from '../ai-studio/ai-studio.module';
import { QBIdGenerator } from '../auth/qb-id.generator';

@Module({
  imports: [PrismaModule, ScheduleModule, WorkModule, AiStudioModule],
  controllers: [CustomerController, ShowcaseController],
  providers: [CustomerService, ShowcaseService, QBIdGenerator],
  exports: [CustomerService, ShowcaseService],
})
export class CustomerModule {}

