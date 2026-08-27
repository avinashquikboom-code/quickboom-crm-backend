import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMarketingBannerDto {
  @ApiProperty({ example: 'Festival Super Sale 50% Off' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Limited time offer on all premium fitness plans' })
  @IsString()
  @IsOptional()
  subtitle?: string;

  @ApiPropertyOptional({ example: 'Upgrade your gym membership today and get free personal training.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'https://res.cloudinary.com/qbapp/image/upload/v123/banner.jpg' })
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/qbapp/image/upload/v123/banner_mobile.jpg' })
  @IsString()
  @IsOptional()
  mobileImageUrl?: string;

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
  isActive?: boolean;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
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
