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
  @ApiPropertyOptional({ example: 1, description: 'Option ID or Feature ID' })
  @IsOptional()
  optionId?: number | string;

  @ApiPropertyOptional({ example: 1, description: 'Service ID alias for Option ID' })
  @IsOptional()
  serviceId?: number | string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsInt()
  @Min(0)
  @IsOptional()
  quantity?: number;
}

export class PreviewCustomPlanDto {
  @ApiPropertyOptional({ type: [FeatureSelectionItemDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FeatureSelectionItemDto)
  featureSelections?: FeatureSelectionItemDto[];

  @ApiPropertyOptional({ type: [FeatureSelectionItemDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FeatureSelectionItemDto)
  items?: FeatureSelectionItemDto[];

  @ApiPropertyOptional({ example: 1, description: 'Duration in months (e.g. 1, 3, 6, 12)' })
  @IsOptional()
  duration?: number;

  @ApiPropertyOptional({ example: 'MONTHLY', description: 'MONTHLY or YEARLY' })
  @IsString()
  @IsOptional()
  billingCycle?: string;

  @ApiPropertyOptional({ example: 'MONTH', default: 'MONTH' })
  @IsString()
  @IsOptional()
  durationUnit?: string;
}

export class CreateCustomPlanDto {
  @ApiPropertyOptional({ type: [FeatureSelectionItemDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FeatureSelectionItemDto)
  featureSelections?: FeatureSelectionItemDto[];

  @ApiPropertyOptional({ type: [FeatureSelectionItemDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FeatureSelectionItemDto)
  items?: FeatureSelectionItemDto[];

  @ApiPropertyOptional({ example: 1, description: 'Duration in months' })
  @IsOptional()
  duration?: number;

  @ApiPropertyOptional({ example: 'MONTHLY', description: 'MONTHLY or YEARLY' })
  @IsString()
  @IsOptional()
  billingCycle?: string;

  @ApiPropertyOptional({ example: 'quote_123', description: 'Existing Quote ID' })
  @IsString()
  @IsOptional()
  quoteId?: string;

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

  @ApiPropertyOptional({
    example: 123,
    description: 'Internal CustomPlanOrder.id from create-order',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customPlanOrderId?: number;

  @ApiPropertyOptional({
    example: '123',
    description: 'Internal CustomPlanOrder.id as returned in quoteId',
  })
  @IsString()
  @IsOptional()
  quoteId?: string;

  @ApiPropertyOptional({
    example: '123',
    description: 'Internal CustomPlanOrder.id (not the Razorpay order id)',
  })
  @IsString()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ example: 'sig_abc123' })
  @IsString()
  @IsOptional()
  signature?: string;

  @ApiPropertyOptional({ example: 'razorpay_signature' })
  @IsString()
  @IsOptional()
  razorpay_signature?: string;

  @ApiPropertyOptional({ example: 'razorpay_payment_id' })
  @IsString()
  @IsOptional()
  razorpay_payment_id?: string;

  @ApiPropertyOptional({ example: 'razorpay_order_id' })
  @IsString()
  @IsOptional()
  razorpay_order_id?: string;
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
