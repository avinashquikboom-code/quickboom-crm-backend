import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BannerService } from './banner.service';
import { BannerUploadService } from './banner-upload.service';
import { BannerController } from './banner.controller';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { TrendingModule } from '../trending/trending.module';

@Module({
  imports: [PrismaModule, TrendingModule],
  controllers: [BannerController, VideoController],
  providers: [BannerService, BannerUploadService, VideoService],
  exports: [BannerService, BannerUploadService, VideoService],
})
export class MarketingModule {}
