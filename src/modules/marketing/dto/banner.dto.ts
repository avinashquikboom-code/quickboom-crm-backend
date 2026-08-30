import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateMarketingBannerDto {
  @ApiPropertyOptional({ example: 'Festival Super Sale 50% Off' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Limited time offer on all premium fitness plans' })
  @IsString()
  @IsOptional()
  subtitle?: string;

  @ApiPropertyOptional({ example: 'Upgrade your gym membership today and get free personal training.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/banner.jpg' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'marketing/banners/1724783921-xyz123-banner.jpg' })
  @IsString()
  @IsOptional()
  imagePublicId?: string;

  @ApiPropertyOptional({ example: 'Claim Offer' })
  @IsString()
  @IsOptional()
  ctaText?: string;

  @ApiPropertyOptional({ example: 'https://quickboom.com/plans/festival' })
  @IsString()
  @IsOptional()
  ctaUrl?: string;

  @ApiPropertyOptional({ example: 10, default: 0 })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  priority?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => (value === 'false' || value === false || value === 0 || value === '0') ? false : true)
  isActive?: boolean;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => (value === 'false' || value === false || value === 0 || value === '0') ? false : true)
  isPublished?: boolean;

  @ApiPropertyOptional({ example: '2026-08-20T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startAt?: string;

  @ApiPropertyOptional({ example: '2026-09-20T23:59:59.000Z' })
  @IsDateString()
  @IsOptional()
  endAt?: string;
}

export class UpdateMarketingBannerDto extends PartialType(CreateMarketingBannerDto) {}

export class QueryMarketingBannerDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  isPublished?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}

export class UpdateBannerPublishDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  @IsNotEmpty()
  isPublished: boolean;
}

export class UpdateBannerStatusDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  @IsNotEmpty()
  isActive: boolean;
}
