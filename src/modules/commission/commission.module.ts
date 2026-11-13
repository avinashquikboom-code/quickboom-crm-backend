import { Module } from '@nestjs/common';
import { CommissionController } from './commission.controller';
import { MobileCommissionController } from './mobile-commission.controller';
import { CommissionService } from './commission.service';
import { CommissionWalletService } from './commission-wallet.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LeadLimitModule } from '../lead-limit/lead-limit.module';

@Module({
  imports: [PrismaModule],
  controllers: [CommissionController],
  providers: [CommissionService],
  exports: [CommissionService],
})
export class CommissionModule {}
