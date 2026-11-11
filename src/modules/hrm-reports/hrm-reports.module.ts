import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { PayrollModule } from '../payroll/payroll.module';
import { S3Module } from '../s3/s3.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { HrmReportsController, MyHrmReportsController } from './hrm-reports.controller';
import { HrmReportsService } from './hrm-reports.service';

@Module({
  imports: [PrismaModule, PayrollModule, EmailModule, WhatsappModule, S3Module],
  controllers: [HrmReportsController, MyHrmReportsController],
  providers: [HrmReportsService],
  exports: [HrmReportsService],
})
export class HrmReportsModule {}
