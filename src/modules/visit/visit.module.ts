import { Module } from '@nestjs/common';
import { VisitController } from './visit.controller';
import { MobileVisitController } from './mobile-visit.controller';
import { VisitService } from './visit.service';
import { CrmEmployeeAccessGuard } from '../../common/guards/crm-employee-access.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, WhatsappModule, NotificationModule],
  controllers: [VisitController, MobileVisitController],
  providers: [VisitService, CrmEmployeeAccessGuard],
  exports: [VisitService],
})
export class VisitModule {}

