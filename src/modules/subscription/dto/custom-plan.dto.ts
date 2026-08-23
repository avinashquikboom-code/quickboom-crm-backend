import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FeatureSelectionItemDto {
  @ApiProperty({ example: 1, description: 'Option ID or Feature ID' })
  @IsInt()
  @IsNotEmpty()
  optionId: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;
}

export class PreviewCustomPlanDto {
  @ApiProperty({ type: [FeatureSelectionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureSelectionItemDto)
  featureSelections: FeatureSelectionItemDto[];

  @ApiProperty({ example: 3, description: 'Duration in months (e.g. 1, 3, 6, 12)' })
  @IsInt()
  @Min(1)
  duration: number;

  @ApiPropertyOptional({ example: 'MONTH', default: 'MONTH' })
  @IsString()
  @IsOptional()
  durationUnit?: string;
}

export class CreateCustomPlanDto {
  @ApiProperty({ type: [FeatureSelectionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureSelectionItemDto)
  featureSelections: FeatureSelectionItemDto[];

  @ApiProperty({ example: 3, description: 'Duration in months' })
  @IsInt()
  @Min(1)
  duration: number;

  @ApiPropertyOptional({ example: 'MONTH', default: 'MONTH' })
  @IsString()
  @IsOptional()
  durationUnit?: string;

  @ApiPropertyOptional({ example: 'RAZORPAY', default: 'RAZORPAY' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;
}

export class VerifyCustomPlanPaymentDto {
  @ApiProperty({ example: 'pay_ABC123456789' })
  @IsString()
  @IsNotEmpty()
  paymentId: string;

  @ApiPropertyOptional({ example: 'order_XYZ987654321' })
  @IsString()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ example: 'sig_abc123' })
  @IsString()
  @IsOptional()
  signature?: string;
}

export class CreateCustomPlanOptionDto {
  @ApiProperty({ example: 'Influencer Promotion Reels' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'INFLUENCER_REEL' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiPropertyOptional({ example: 'High-reach influencer collaboration reel' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'CONTENT', default: 'CONTENT' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiProperty({ example: 1500, description: 'Monthly price per unit in INR' })
  @IsNumber()
  @Min(0)
  monthlyPrice: number;

  @ApiPropertyOptional({ example: 'PER_UNIT', default: 'PER_UNIT' })
  @IsString()
  @IsOptional()
  pricingType?: string;

  @ApiPropertyOptional({ example: 'Reel', default: 'unit' })
  @IsString()
  @IsOptional()
  unitName?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  minQuantity?: number;

  @ApiPropertyOptional({ example: 50, default: 50 })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxQuantity?: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsInt()
  @IsOptional()
  defaultQuantity?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsInt()
  @IsOptional()
  sortOrder?: number;
}

export class UpdateCustomPlanOptionDto {
  @ApiPropertyOptional({ example: 'Influencer Promotion Reels' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'CONTENT' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ example: 1800 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyPrice?: number;

  @ApiPropertyOptional({ example: 'PER_UNIT' })
  @IsString()
  @IsOptional()
  pricingType?: string;

  @ApiPropertyOptional({ example: 'Reel' })
  @IsString()
  @IsOptional()
  unitName?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  minQuantity?: number;

  @ApiPropertyOptional({ example: 100 })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxQuantity?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  sortOrder?: number;
}
