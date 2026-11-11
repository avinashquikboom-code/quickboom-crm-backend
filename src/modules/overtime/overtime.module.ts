import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { OvertimeController } from './overtime.controller';
import { OvertimeNoticeService } from './overtime-notice.service';
import { OvertimeService } from './overtime.service';

@Module({
  imports: [PrismaModule, WhatsappModule],
  controllers: [OvertimeController],
  providers: [OvertimeService, OvertimeNoticeService],
  exports: [OvertimeService],
})
export class OvertimeModule {}
