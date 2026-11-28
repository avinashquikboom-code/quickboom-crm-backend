import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmployeeModule } from '../employee/employee.module';
import { HiringController } from './hiring.controller';
import { HiringService } from './hiring.service';

@Module({
  imports: [PrismaModule, S3Module, EmailModule, WhatsappModule, EmployeeModule],
  controllers: [HiringController],
  providers: [HiringService],
  exports: [HiringService],
})
export class HiringModule {}
