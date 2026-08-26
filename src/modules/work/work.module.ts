import { Module } from '@nestjs/common';
import { WorkController } from './work.controller';
import { WorkService } from './work.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule], // ✅ ONLY PrismaModule — circular dependency eliminated
  controllers: [WorkController],
  providers: [WorkService],
  exports: [WorkService],
})
export class WorkModule {}
