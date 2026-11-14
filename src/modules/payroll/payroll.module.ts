import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryTargetService } from './salary-target.service';
import { DeductionsService } from './deductions.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [PayrollController],
  providers: [PayrollService, SalaryTargetService, DeductionsService],
  exports: [PayrollService, DeductionsService],
})
export class PayrollModule {}
