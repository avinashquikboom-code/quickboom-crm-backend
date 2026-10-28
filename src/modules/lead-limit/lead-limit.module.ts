import { Module } from '@nestjs/common';
import { LeadLimitService } from './lead-limit.service';
import { LeadLimitController } from './lead-limit.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkModule } from '../work/work.module';

@Module({
  imports: [PrismaModule, WorkModule],
  controllers: [LeadLimitController],
  providers: [LeadLimitService],
  exports: [LeadLimitService],
})
export class LeadLimitModule {}
