import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { WorkModule } from '../work/work.module';
import { NotificationModule } from '../notification/notification.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, ScheduleModule, WorkModule, NotificationModule, InvoiceModule, WhatsappModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
