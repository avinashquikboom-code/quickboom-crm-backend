import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TrendingCategory } from '@prisma/client';

const transformBoolean = ({ value }: { value: any }) => {
  if (value === 'true' || value === true || value === 1 || value === '1') return true;
  if (value === 'false' || value === false || value === 0 || value === '0') return false;
  return value;
};

const transformJson = ({ value }: { value: any }) => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return value;
    }
  }
  return value;
};

export class CreateTrendingContentDto {
  @ApiPropertyOptional({ example: 'Summer Reel Campaign' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Create a short-form product reel for summer promotion.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: TrendingCategory, example: TrendingCategory.REEL })
  @IsEnum(TrendingCategory)
  @IsOptional()
  category?: TrendingCategory;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/thumbnails/summer.jpg' })
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/videos/summer.mp4' })
  @IsString()
  @IsOptional()
  mediaUrl?: string;

  @ApiPropertyOptional({ enum: ['IMAGE', 'VIDEO'], example: 'IMAGE' })
  @IsOptional()
  mediaType?: 'IMAGE' | 'VIDEO';

  @ApiPropertyOptional({ enum: ['UPLOAD', 'URL'], example: 'URL' })
  @IsOptional()
  mediaSource?: 'UPLOAD' | 'URL';

  @ApiPropertyOptional({ example: 'https://cdn.example.com/images/banner.jpg' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/videos/reel.mp4' })
  @IsString()
  @IsOptional()
  videoUrl?: string;

  @ApiPropertyOptional({ example: 'View Idea' })
  @IsString()
  @IsOptional()
  ctaText?: string;

  @ApiPropertyOptional({ example: 'https://instagram.com/reels/example' })
  @IsString()
  @IsOptional()
  ctaUrl?: string;

  @ApiPropertyOptional({ example: 'INSTAGRAM', default: 'INSTAGRAM' })
  @IsString()
  @IsOptional()
  platform?: string;

  @ApiPropertyOptional({ example: 'ENGAGEMENT', default: 'ENGAGEMENT' })
  @IsString()
  @IsOptional()
  objective?: string;

  @ApiPropertyOptional({ example: 10, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  priority?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @Transform(transformBoolean)
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @ApiPropertyOptional({ example: true, default: true })
  @Transform(transformBoolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '2026-08-27T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startAt?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.000Z' })
  @IsDateString()
  @IsOptional()
  endAt?: string;

  @ApiPropertyOptional({ description: 'Target customer ID if Super Admin overrides context' })
  @IsOptional()
  customerId?: number | string;

  @ApiPropertyOptional({ description: 'Additional structured JSON metadata' })
  @Transform(transformJson)
  @IsOptional()
  metadata?: any;
}

export class UpdateTrendingContentDto {
  @ApiPropertyOptional({ example: 'Summer Reel Campaign 2026' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated short-form reel script' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: TrendingCategory })
  @IsEnum(TrendingCategory)
  @IsOptional()
  category?: TrendingCategory;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/thumbnails/summer2.jpg' })
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/videos/summer2.mp4' })
  @IsString()
  @IsOptional()
  mediaUrl?: string;

  @ApiPropertyOptional({ enum: ['IMAGE', 'VIDEO'], example: 'IMAGE' })
  @IsOptional()
  mediaType?: 'IMAGE' | 'VIDEO';

  @ApiPropertyOptional({ enum: ['UPLOAD', 'URL'], example: 'URL' })
  @IsOptional()
  mediaSource?: 'UPLOAD' | 'URL';

  @ApiPropertyOptional({ example: 'https://cdn.example.com/images/banner.jpg' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/videos/reel.mp4' })
  @IsString()
  @IsOptional()
  videoUrl?: string;

  @ApiPropertyOptional({ example: 'Learn More' })
  @IsString()
  @IsOptional()
  ctaText?: string;

  @ApiPropertyOptional({ example: 'https://instagram.com/p/updated' })
  @IsString()
  @IsOptional()
  ctaUrl?: string;

  @ApiPropertyOptional({ example: 'INSTAGRAM' })
  @IsString()
  @IsOptional()
  platform?: string;

  @ApiPropertyOptional({ example: 'SALES' })
  @IsString()
  @IsOptional()
  objective?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  priority?: number;

  @ApiPropertyOptional({ example: true })
  @Transform(transformBoolean)
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @ApiPropertyOptional({ example: true })
  @Transform(transformBoolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '2026-08-27T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startAt?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.000Z' })
  @IsDateString()
  @IsOptional()
  endAt?: string;

  @ApiPropertyOptional()
  @Transform(transformJson)
  @IsOptional()
  metadata?: any;
}

export class QueryTrendingDto {
  @ApiPropertyOptional({ enum: TrendingCategory })
  @IsEnum(TrendingCategory)
  @IsOptional()
  category?: TrendingCategory;

  @ApiPropertyOptional({ enum: ['IMAGE', 'VIDEO', 'ALL'] })
  @IsOptional()
  mediaType?: 'IMAGE' | 'VIDEO' | 'ALL';

  @ApiPropertyOptional({ example: 'summer' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  isPublished?: string | boolean;

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  isActive?: string | boolean;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  page?: number | string;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  limit?: number | string;

  @ApiPropertyOptional()
  @IsOptional()
  customerId?: number | string;
}

export class UpdatePublishStatusDto {
  @ApiProperty({ example: true })
  @Transform(transformBoolean)
  @IsBoolean()
  isPublished: boolean;
}

export class UpdateActiveStatusDto {
  @ApiProperty({ example: true })
  @Transform(transformBoolean)
  @IsBoolean()
  isActive: boolean;
}
