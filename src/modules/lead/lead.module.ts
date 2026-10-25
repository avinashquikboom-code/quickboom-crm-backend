import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';
@Module({ imports: [PrismaModule], controllers: [LeadController], providers: [LeadService], exports: [LeadService] })
export class LeadModule {}
