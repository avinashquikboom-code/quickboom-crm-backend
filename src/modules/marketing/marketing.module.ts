import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BannerService } from './banner.service';
import { BannerController } from './banner.controller';
import { TrendingModule } from '../trending/trending.module';

@Module({
  imports: [PrismaModule, TrendingModule],
  controllers: [BannerController],
  providers: [BannerService],
  exports: [BannerService],
})
export class MarketingModule {}
