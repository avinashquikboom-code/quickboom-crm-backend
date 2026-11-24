import { Module } from '@nestjs/common';
import { BusinessGrowthController } from './business-growth.controller';
import { BusinessGrowthService } from './business-growth.service';
import { GoogleOAuthClient } from './google/google-oauth.client';
import { GoogleApiClient } from './google/google-api.client';
import { GoogleAdsClient } from './google/google-ads.client';
import { GoogleBusinessClient, GoogleReviewsClient, GooglePerformanceClient } from './google/google-business.client';
import { GoogleCredentialsCrypto } from './google/google-credentials.crypto';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BusinessGrowthController],
  providers: [BusinessGrowthService, GoogleOAuthClient, GoogleApiClient, GoogleAdsClient, GoogleBusinessClient, GoogleReviewsClient, GooglePerformanceClient, GoogleCredentialsCrypto],
  exports: [BusinessGrowthService],
})
export class BusinessGrowthModule {}
