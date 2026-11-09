import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryTargetService } from './salary-target.service';

@Module({
  controllers: [PayrollController],
  providers: [PayrollService, SalaryTargetService],
  exports: [PayrollService],
})
export class PayrollModule {}
