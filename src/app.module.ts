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
import { RemoteWorkModule } from './modules/remote-work/remote-work.module';
import { CompanyModule } from './modules/company/company.module';
import { ShiftModule } from './modules/shift/shift.module';
import { LoanModule } from './modules/loan/loan.module';
import { ClaimModule } from './modules/claim/claim.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { PaymentModule } from './modules/payment/payment.module';
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
    PaymentModule,
    ScheduleModule,
    WorkModule,
    EmployeeModule,
    DepartmentModule,
    DesignationModule,
    OfficeModule,
    AttendanceModule,
    LeaveModule,
    RemoteWorkModule,
    TeamModule,
    VisitModule,
    InvoiceModule,
    ReportModule,
    NotificationModule,
    AuditLogModule,
    LeadModule,
    CompanyModule,
    ContactModule,
    DealModule,
    TaskModule,
    LocationModule,
    PayrollModule,
    DashboardModule,
    DataCaptureModule,
    DataManagementModule,
    ShiftModule,
    LoanModule,
    ClaimModule,
  ],
  controllers: [AppController],
})
export class AppModule {}


