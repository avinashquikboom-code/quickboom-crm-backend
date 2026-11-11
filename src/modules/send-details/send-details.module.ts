import { Module, forwardRef } from '@nestjs/common';
import { SendDetailsService } from './send-details.service';
import { SendDetailsController } from './send-details.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';
import { LeadModule } from '../lead/lead.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [
    PrismaModule,
    WhatsappModule,
    EmailModule,
    forwardRef(() => LeadModule),
    S3Module,
  ],
  controllers: [SendDetailsController],
  providers: [SendDetailsService],
  exports: [SendDetailsService],
})
export class SendDetailsModule {}
