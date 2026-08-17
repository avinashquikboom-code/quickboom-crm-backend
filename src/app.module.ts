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

import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    LeadModule,
    ContactModule,
    DealModule,
    TaskModule,
    LocationModule,
    PayrollModule,
    DashboardModule,
    DataCaptureModule,
    DataManagementModule,
    SubscriptionModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
