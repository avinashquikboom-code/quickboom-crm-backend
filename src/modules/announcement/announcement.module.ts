import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [AnnouncementController],
  providers: [AnnouncementService],
})
export class AnnouncementModule {}
