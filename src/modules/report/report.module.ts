import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { EmployeeLeadStageReportService } from './employee-lead-stage-report.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
  imports: [PrismaModule, InvoiceModule],
  controllers: [ReportController],
  providers: [ReportService, EmployeeLeadStageReportService],
  exports: [ReportService, EmployeeLeadStageReportService],
})
export class ReportModule {}
