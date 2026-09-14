import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsInt,
  IsNumber,
  Min,
  IsIn,
  IsBoolean,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class GenerateContentDto {
  @ApiProperty({
    description: 'Type of AI content to generate',
    enum: ['POST', 'POSTER', 'VIDEO', 'CAPTION', 'HASHTAGS'],
    example: 'POST',
  })
  @IsString()
  @IsIn(['POST', 'POSTER', 'VIDEO', 'CAPTION', 'HASHTAGS'])
  type: string;

  @ApiProperty({ description: 'Product or Service name', example: 'Organic Cold Brew Coffee' })
  @IsString()
  @IsNotEmpty()
  product: string;

  @ApiPropertyOptional({ description: 'Campaign objective', example: 'Product Launch' })
  @IsOptional()
  @IsString()
  objective?: string;

  @ApiPropertyOptional({ description: 'Target audience', example: 'Coffee enthusiasts, working professionals' })
  @IsOptional()
  @IsString()
  targetAudience?: string;

  @ApiPropertyOptional({
    description: 'Target social media platform',
    enum: ['INSTAGRAM', 'FACEBOOK', 'YOUTUBE', 'TIKTOK', 'LINKEDIN'],
    default: 'INSTAGRAM',
  })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'Language of generated copy', default: 'English' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Tone of voice', default: 'Premium' })
  @IsOptional()
  @IsString()
  tone?: string;

  @ApiPropertyOptional({ description: 'Call to action', example: 'Order Now' })
  @IsOptional()
  @IsString()
  cta?: string;

  @ApiPropertyOptional({ description: 'Additional creative instructions or offer details' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({ description: 'Optional reference image URL' })
  @IsOptional()
  @IsString()
  referenceImageUrl?: string;
}

export class UpdateGenerationDto {
  @ApiPropertyOptional({ description: 'Updated caption text' })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({ description: 'Updated hashtags array' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];
}

export class PurchaseCreditsDto {
  @ApiProperty({ description: 'Number of AI credits to purchase', example: 50 })
  @IsInt()
  @Min(5)
  @Type(() => Number)
  creditsCount: number;

  @ApiPropertyOptional({ description: 'Payment method', default: 'RAZORPAY' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;
}

export class VerifyCreditPurchaseDto {
  @ApiProperty({ description: 'Number of credits purchased' })
  @IsInt()
  @Min(5)
  @Type(() => Number)
  creditsCount: number;

  @ApiProperty({ description: 'Razorpay payment ID' })
  @IsString()
  @IsNotEmpty()
  razorpayPaymentId: string;

  @ApiProperty({ description: 'Razorpay order ID' })
  @IsString()
  @IsNotEmpty()
  razorpayOrderId: string;

  @ApiProperty({ description: 'Razorpay signature' })
  @IsString()
  @IsNotEmpty()
  razorpaySignature: string;
}

export class UpdateAiServiceConfigDto {
  @ApiPropertyOptional({ description: 'Credit cost per generation' })
  @IsOptional()
  @IsInt()
  @Min(0)
  creditCost?: number;

  @ApiPropertyOptional({ description: 'Price per credit in INR' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerCredit?: number;

  @ApiPropertyOptional({ description: 'Pack purchase price' })
  @IsOptional()
  @IsNumber()
  packPrice?: number;

  @ApiPropertyOptional({ description: 'Is service active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
