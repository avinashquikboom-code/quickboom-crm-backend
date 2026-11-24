import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  IsIn,
  Min,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QueryCampaignsDto {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  dateRange?: string;
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty({ message: 'Campaign name is required' })
  name!: string;

  @IsString()
  @IsOptional()
  objective?: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'budgetDaily must be a valid number' })
  @Min(100, { message: 'budgetDaily must be at least ₹100' })
  @IsNotEmpty({ message: 'Daily budget is required' })
  budgetDaily!: number;

  @IsString()
  @IsOptional()
  bidStrategy?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetLocations?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  headlines?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  descriptions?: string[];

  @IsString()
  @IsNotEmpty({ message: 'Final landing page URL is required' })
  finalUrl!: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class UpdateCampaignStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['ACTIVE', 'PAUSED', 'ENDED'], {
    message: 'status must be ACTIVE, PAUSED, or ENDED',
  })
  status!: 'ACTIVE' | 'PAUSED' | 'ENDED';
}

export class UpdateCampaignBudgetDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'dailyBudget must be a valid number' })
  @Min(100, { message: 'dailyBudget must be at least ₹100' })
  @IsNotEmpty({ message: 'dailyBudget is required' })
  dailyBudget!: number;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class UpdateBusinessProfileDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  website?: string;

  @IsOptional()
  openingHours?: Record<string, string>;
}

export class AddProfilePhotoDto {
  @IsString()
  @IsNotEmpty({ message: 'Photo URL is required' })
  url!: string;

  @IsString()
  @IsOptional()
  tag?: string;
}

export class QueryReviewsDto {
  @IsString()
  @IsOptional()
  filter?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  star?: number;

  @IsString()
  @IsOptional()
  search?: string;
}

export class ReplyReviewDto {
  @IsString()
  @IsNotEmpty({ message: 'Reply text cannot be empty' })
  replyText!: string;

  @IsBoolean()
  @IsOptional()
  isAiGenerated?: boolean;
}

export class GenerateAiReplyDto {
  @IsString()
  @IsOptional()
  @IsIn(['PROFESSIONAL', 'FRIENDLY', 'APOLOGETIC', 'FORMAL'], {
    message: 'tone must be PROFESSIONAL, FRIENDLY, APOLOGETIC, or FORMAL',
  })
  tone?: 'PROFESSIONAL' | 'FRIENDLY' | 'APOLOGETIC' | 'FORMAL';
}

export class UpdateGrowthSettingsDto {
  @IsString()
  @IsOptional()
  @IsIn(['HOURLY', 'DAILY', 'MANUAL'], {
    message: 'autoSyncFrequency must be HOURLY, DAILY, or MANUAL',
  })
  autoSyncFrequency?: 'HOURLY' | 'DAILY' | 'MANUAL';

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  lowBudgetAlertThreshold?: number;

  @IsBoolean()
  @IsOptional()
  notifyOnNegativeReview?: boolean;

  @IsString()
  @IsOptional()
  defaultAiReplyTone?: string;
}

export class GoogleOAuthConnectDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['ADS', 'BUSINESS_PROFILE'], {
    message: 'provider must be ADS or BUSINESS_PROFILE',
  })
  provider!: 'ADS' | 'BUSINESS_PROFILE';
}

export class SelectLocationDto {
  @IsString()
  @IsNotEmpty({ message: 'locationId cannot be empty' })
  locationId!: string;
}

