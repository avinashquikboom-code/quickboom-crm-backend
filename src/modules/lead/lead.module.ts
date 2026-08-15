import { Module } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadController } from './lead.controller';
import { LeadRepository } from './lead.repository';

@Module({
  controllers: [LeadController],
  providers: [LeadService, LeadRepository],
  exports: [LeadService, LeadRepository],
})
export class LeadModule {}
