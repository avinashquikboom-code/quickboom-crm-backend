import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { FinancialMetricsService } from './financial-metrics.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, EmailModule, WhatsappModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, FinancialMetricsService],
  exports: [InvoiceService, FinancialMetricsService],
})
export class InvoiceModule {}
