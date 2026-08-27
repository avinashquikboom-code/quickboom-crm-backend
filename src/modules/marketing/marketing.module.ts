import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BannerService } from './banner.service';
import { BannerUploadService } from './banner-upload.service';
import { BannerController } from './banner.controller';
import { TrendingModule } from '../trending/trending.module';

@Module({
  imports: [PrismaModule, TrendingModule],
  controllers: [BannerController],
  providers: [BannerService, BannerUploadService],
  exports: [BannerService, BannerUploadService],
})
export class MarketingModule {}
