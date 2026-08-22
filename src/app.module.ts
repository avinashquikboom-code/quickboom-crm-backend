import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { LeadModule } from './modules/lead/lead.module';
import { ContactModule } from './modules/contact/contact.module';
import { DealModule } from './modules/deal/deal.module';
import { TaskModule } from './modules/task/task.module';
import { LocationModule } from './modules/location/location.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DataCaptureModule } from './modules/data-capture/data-capture.module';
import { DataManagementModule } from './modules/data-management/data-management.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { CustomerModule } from './modules/customer/customer.module';
import { WorkModule } from './modules/work/work.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { TeamModule } from './modules/team/team.module';
import { VisitModule } from './modules/visit/visit.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { ReportModule } from './modules/report/report.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { DepartmentModule } from './modules/department/department.module';
import { DesignationModule } from './modules/designation/designation.module';
import { OfficeModule } from './modules/office/office.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { LeaveModule } from './modules/leave/leave.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    CustomerModule,
    SubscriptionModule,
    WorkModule,
    EmployeeModule,
    DepartmentModule,
    DesignationModule,
    OfficeModule,
    AttendanceModule,
    LeaveModule,
    TeamModule,
    VisitModule,
    InvoiceModule,
    ReportModule,
    NotificationModule,
    AuditLogModule,
    LeadModule,
    ContactModule,
    DealModule,
    TaskModule,
    LocationModule,
    PayrollModule,
    DashboardModule,
    DataCaptureModule,
    DataManagementModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
