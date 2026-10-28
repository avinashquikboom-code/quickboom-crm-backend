import { Module, forwardRef } from '@nestjs/common';
import { DataCaptureController } from './data-capture.controller';
import { DataCaptureService } from './data-capture.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LeadModule } from '../lead/lead.module';

@Module({
  imports: [PrismaModule, forwardRef(() => LeadModule)],
  controllers: [DataCaptureController],
  providers: [DataCaptureService],
  exports: [DataCaptureService],
})
export class DataCaptureModule {}
