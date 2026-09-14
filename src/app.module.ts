import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { LeadModule } from './modules/lead/lead.module';
import { LeadLimitModule } from './modules/lead-limit/lead-limit.module';
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
import { ReceiptModule } from './modules/receipt/receipt.module';
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
import { IntegrationSettingsModule } from './modules/integration-settings/integration-settings.module';
import { TrendingModule } from './modules/trending/trending.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { S3Module } from './modules/s3/s3.module';
import { Msg91Module } from './modules/msg91/msg91.module';
import { SocialMediaHandlerModule } from './modules/social-media-handler/social-media-handler.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { InfluencerModule } from './modules/influencer/influencer.module';
import { AiStudioModule } from './modules/ai-studio/ai-studio.module';
import { SocialPublishingModule } from './modules/social-publishing/social-publishing.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    S3Module,
    Msg91Module,
    IntegrationSettingsModule,
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
    ReceiptModule,
    ReportModule,
    NotificationModule,
    AuditLogModule,
    LeadModule,
    LeadLimitModule,
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
    TrendingModule,
    MarketingModule,
    SocialMediaHandlerModule,
    MarketplaceModule,
    InfluencerModule,
    AiStudioModule,
    SocialPublishingModule,
  ],
  controllers: [AppController],
})
export class AppModule {}


