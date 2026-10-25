import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { FcmService } from './fcm.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { EmployeeCommunicationService } from './employee-communication.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [PrismaModule, ConfigModule, WhatsappModule],
  controllers: [NotificationController],
  providers: [NotificationService, FcmService, NotificationSchedulerService, EmployeeCommunicationService],
  exports: [NotificationService, FcmService, NotificationSchedulerService, EmployeeCommunicationService],
})
export class NotificationModule {}

