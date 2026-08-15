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
  ],
})
export class AppModule {}
