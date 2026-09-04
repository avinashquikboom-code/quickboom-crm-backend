import { Module } from '@nestjs/common';
import { VisitController } from './visit.controller';
import { MobileVisitController } from './mobile-visit.controller';
import { VisitService } from './visit.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VisitController, MobileVisitController],
  providers: [VisitService],
  exports: [VisitService],
})
export class VisitModule {}

