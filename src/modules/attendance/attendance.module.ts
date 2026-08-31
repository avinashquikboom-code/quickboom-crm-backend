import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { HrmsLiveDashboardController } from './hrms-live-dashboard.controller';
import { AttendanceService } from './attendance.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AttendanceController, HrmsLiveDashboardController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
