import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { HrmsLiveDashboardController } from './hrms-live-dashboard.controller';
import { AttendanceService } from './attendance.service';
import { LateMarkReportService } from './late-mark-report.service';
import { LateMarkReportController } from './late-mark-report.controller';
import { LateMarkReportScheduler } from './late-mark-report.scheduler';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [AttendanceController, HrmsLiveDashboardController, LateMarkReportController],
  providers: [AttendanceService, LateMarkReportService, LateMarkReportScheduler],
  exports: [AttendanceService, LateMarkReportService],
})
export class AttendanceModule {}
