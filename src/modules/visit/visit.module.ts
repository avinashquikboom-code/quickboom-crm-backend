import { Module } from '@nestjs/common';
import { VisitController } from './visit.controller';
import { MobileVisitController } from './mobile-visit.controller';
import { VisitService } from './visit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, WhatsappModule, NotificationModule],
  controllers: [VisitController, MobileVisitController],
  providers: [VisitService],
  exports: [VisitService],
})
export class VisitModule {}

