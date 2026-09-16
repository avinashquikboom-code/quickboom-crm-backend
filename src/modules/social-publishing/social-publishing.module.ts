import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SocialPublishingController } from './social-publishing.controller';
import { SocialAccountService } from './social-account.service';
import { SocialPublishService } from './social-publish.service';
import {
  InstagramProvider,
  FacebookProvider,
  YouTubeProvider,
  LinkedInProvider,
  TikTokProvider,
} from './providers/platform-providers';

@Module({
  imports: [PrismaModule],
  controllers: [SocialPublishingController],
  providers: [
    SocialAccountService,
    SocialPublishService,
    InstagramProvider,
    FacebookProvider,
    YouTubeProvider,
    LinkedInProvider,
    TikTokProvider,
  ],
  exports: [
    SocialAccountService,
    SocialPublishService,
    InstagramProvider,
    FacebookProvider,
    YouTubeProvider,
    LinkedInProvider,
    TikTokProvider,
  ],
})
export class SocialPublishingModule {}
