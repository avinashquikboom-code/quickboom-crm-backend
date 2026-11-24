import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * The previous implementation simulated Google data and mutations in memory.
 * Fail closed until a Google-backed integration is configured and verified.
 */
@Injectable()
export class BusinessGrowthService {
  private unavailable(): never {
    throw new ServiceUnavailableException(
      'Google Business Growth integration is unavailable: real Google API access and synchronization have not been configured.',
    );
  }

  async getOverview() { return this.unavailable(); }
  async getGoogleAdsAccounts() { return this.unavailable(); }
  async getCampaigns(..._args: unknown[]) { return this.unavailable(); }
  async createCampaign(..._args: unknown[]) { return this.unavailable(); }
  async updateCampaignStatus(..._args: unknown[]) { return this.unavailable(); }
  async updateCampaignBudget(..._args: unknown[]) { return this.unavailable(); }
  async syncGoogleAds() { return this.unavailable(); }
  async getBusinessProfile(..._args: unknown[]) { return this.unavailable(); }
  async updateBusinessProfile(..._args: unknown[]) { return this.unavailable(); }
  async addProfilePhoto(..._args: unknown[]) { return this.unavailable(); }
  async syncBusinessProfile(..._args: unknown[]) { return this.unavailable(); }
  async selectLocation(..._args: unknown[]) { return this.unavailable(); }
  async getReviews(..._args: unknown[]) { return this.unavailable(); }
  async replyToReview(..._args: unknown[]) { return this.unavailable(); }
  async generateAiReply(..._args: unknown[]) { return this.unavailable(); }
  async getAnalytics(..._args: unknown[]) { return this.unavailable(); }
  async getSettings() { return this.unavailable(); }
  async updateSettings(..._args: unknown[]) { return this.unavailable(); }
  async connectGoogleOAuth(..._args: unknown[]) { return this.unavailable(); }
  async disconnectGoogleOAuth(..._args: unknown[]) { return this.unavailable(); }
}
