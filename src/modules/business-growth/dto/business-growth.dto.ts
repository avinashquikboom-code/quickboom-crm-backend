export class QueryCampaignsDto {
  status?: string;
  search?: string;
  dateRange?: string;
}

export class CreateCampaignDto {
  name!: string;
  objective?: string;
  budgetDaily!: number;
  bidStrategy?: string;
  targetLocations?: string[];
  headlines?: string[];
  descriptions?: string[];
  finalUrl!: string;
  status?: string;
}

export class UpdateCampaignStatusDto {
  status!: 'ACTIVE' | 'PAUSED' | 'ENDED';
}

export class UpdateCampaignBudgetDto {
  dailyBudget!: number;
  reason?: string;
}

export class UpdateBusinessProfileDto {
  name?: string;
  category?: string;
  description?: string;
  address?: string;
  phone?: string;
  website?: string;
  openingHours?: Record<string, string>;
}

export class ReplyReviewDto {
  replyText!: string;
  isAiGenerated?: boolean;
}

export class GenerateAiReplyDto {
  tone?: 'PROFESSIONAL' | 'FRIENDLY' | 'APOLOGETIC' | 'FORMAL';
}

export class UpdateGrowthSettingsDto {
  autoSyncFrequency?: 'HOURLY' | 'DAILY' | 'MANUAL';
  lowBudgetAlertThreshold?: number;
  notifyOnNegativeReview?: boolean;
  defaultAiReplyTone?: string;
}
