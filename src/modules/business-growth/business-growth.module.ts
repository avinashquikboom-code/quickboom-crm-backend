import { Module } from '@nestjs/common';
import { BusinessGrowthController } from './business-growth.controller';
import { BusinessGrowthService } from './business-growth.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BusinessGrowthController],
  providers: [BusinessGrowthService],
  exports: [BusinessGrowthService],
})
export class BusinessGrowthModule {}
