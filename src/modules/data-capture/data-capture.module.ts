import { Module } from '@nestjs/common';
import { DataCaptureController } from './data-capture.controller';
import { DataCaptureService } from './data-capture.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DataCaptureController],
  providers: [DataCaptureService],
  exports: [DataCaptureService],
})
export class DataCaptureModule {}
