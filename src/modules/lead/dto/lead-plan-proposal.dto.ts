import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class SetPlanPreferenceDto {
  @ApiProperty({ example: 'DEFAULT', enum: ['DEFAULT', 'CUSTOM'] })
  @IsString()
  @IsIn(['DEFAULT', 'CUSTOM'])
  planPreferenceType: 'DEFAULT' | 'CUSTOM';

  @ApiProperty({ example: 'Needs WhatsApp automation for 50 staff and monthly analytics.' })
  @IsString()
  @IsNotEmpty()
  customerRequirements: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  readyToPropose?: boolean;
}

export class CustomPlanFeatureDto {
  @ApiProperty({ example: 'Reels' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: '4' })
  @IsOptional()
  @IsString()
  quantity?: string;

  @ApiPropertyOptional({ example: 'Monthly promotional reels' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CustomPlanProposalConfigDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  planId?: number;

  @ApiProperty({ example: 'Growth Plus CRM Bundle' })
  @IsString()
  @IsNotEmpty()
  planName: string;

  @ApiPropertyOptional({ example: 'CUST-101-01' })
  @IsOptional()
  @IsString()
  planCode?: string;

  @ApiPropertyOptional({ example: 'Customized CRM and social growth package' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 9999 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyPrice?: number;

  @ApiPropertyOptional({ example: 95990 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  yearlyPrice?: number;

  @ApiPropertyOptional({ example: 'MONTHLY', enum: ['MONTHLY', 'YEARLY'] })
  @IsOptional()
  @IsString()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingCycle?: 'MONTHLY' | 'YEARLY';

  @ApiPropertyOptional({ type: [String], example: ['CRM', 'WhatsApp', 'Email'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  userLimit?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  leadLimit?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  storageLimit?: number;

  @ApiPropertyOptional({ example: 'GB', enum: ['MB', 'GB'] })
  @IsOptional()
  @IsString()
  @IsIn(['MB', 'GB'])
  storageUnit?: 'MB' | 'GB';

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  whatsappLimit?: number;

  @ApiPropertyOptional({ example: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  emailLimit?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  additionalServices?: string[];

  @ApiPropertyOptional({ type: [CustomPlanFeatureDto] })
  @IsOptional()
  @IsArray()
  features?: Array<CustomPlanFeatureDto | string>;

  @ApiPropertyOptional({ example: 19999 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  customPrice?: number;

  @ApiPropertyOptional({ example: 1500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  discount?: number;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  validUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  terms?: string;
}

export class CreateCustomPlanProposalDto {
  @ApiProperty()
  @ValidateNested()
  @Type(() => CustomPlanProposalConfigDto)
  config: CustomPlanProposalConfigDto;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  sendImmediately?: boolean;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  proposalId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerRequirements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emailAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

export class ResendPlanProposalDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emailAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

export class CreateStandardPlanProposalDto {
  @Type(() => Number)
  @IsNumber()
  planId: number;

  @IsIn(['MONTHLY', 'YEARLY'])
  billingCycle: 'MONTHLY' | 'YEARLY';

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
