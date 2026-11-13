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

export class CustomPlanProposalConfigDto {
  @ApiProperty({ example: 'Growth Plus CRM Bundle' })
  @IsString()
  @IsNotEmpty()
  planName: string;

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

  @ApiProperty({ example: 19999 })
  @Type(() => Number)
  @IsNumber()
  customPrice: number;

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
