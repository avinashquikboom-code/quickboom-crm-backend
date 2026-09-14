export interface PublishResult {
  externalPostId: string;
  externalPostUrl?: string;
}

export interface ISocialProvider {
  readonly platform: string;

  getAuthUrl(state: string): string;

  exchangeToken(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    accountId: string;
    accountName: string;
    username?: string;
    profilePic?: string;
  }>;

  publish(
    account: {
      externalAccountId: string;
      accessToken?: string;
    },
    content: {
      caption: string;
      mediaUrls?: string[];
    },
  ): Promise<PublishResult>;
}
