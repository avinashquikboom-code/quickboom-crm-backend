import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { S3Module } from '../s3/s3.module';
import { NotificationModule } from '../notification/notification.module';
import { TelecallerTargetsService } from './telecaller-targets.service';
import { TelecallerTargetsController } from './telecaller-targets.controller';

@Global()
@Module({
  imports: [PrismaModule, EmailModule, WhatsappModule, S3Module, NotificationModule],
  controllers: [TelecallerTargetsController],
  providers: [TelecallerTargetsService],
  exports: [TelecallerTargetsService],
})
export class TelecallerTargetsModule {}
