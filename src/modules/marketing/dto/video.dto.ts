import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateMarketingVideoDto {
  @ApiPropertyOptional({ example: 'Summer Marketing Campaign' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Discover our newest platform features' })
  @IsString()
  @IsOptional()
  subtitle?: string;

  @ApiPropertyOptional({ example: 'Full walkthrough of our CRM and Marketing automation tools.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/marketing/videos/demo.mp4' })
  @IsString()
  @IsOptional()
  videoUrl?: string;

  @ApiPropertyOptional({ example: 'marketing/videos/1724783921-video.mp4' })
  @IsString()
  @IsOptional()
  videoKey?: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/marketing/videos/thumb.jpg' })
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: 'marketing/videos/1724783921-thumb.jpg' })
  @IsString()
  @IsOptional()
  thumbnailKey?: string;

  @ApiPropertyOptional({ example: 'Watch Now' })
  @IsString()
  @IsOptional()
  ctaText?: string;

  @ApiPropertyOptional({ example: 'https://quickboom.com/campaign' })
  @IsString()
  @IsOptional()
  ctaUrl?: string;

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED'] })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value ? String(value).toUpperCase().trim() : undefined))
  status?: string;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  priority?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    return undefined;
  })
  isActive?: boolean;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    return undefined;
  })
  isPublished?: boolean;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    return undefined;
  })
  showOnHome?: boolean;

  @ApiPropertyOptional({ example: false, default: false })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    return undefined;
  })
  showInIntroduction?: boolean;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === 'null' || value === null || value === undefined ? undefined : value))
  startAt?: string;

  @ApiPropertyOptional({ example: '2026-10-01T23:59:59.000Z' })
  @IsDateString()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === 'null' || value === null || value === undefined ? undefined : value))
  endAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: any;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  customerId?: number;
}

export class UpdateMarketingVideoDto extends PartialType(CreateMarketingVideoDto) {}

export class UpdateVideoStatusDto {
  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    return undefined;
  })
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED'] })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value ? String(value).toUpperCase().trim() : undefined))
  status?: string;
}

export class UpdateVideoPublishDto {
  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    return undefined;
  })
  isPublished!: boolean;
}

export class QueryMarketingVideoDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ example: 'Summer' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: 'ACTIVE' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    return undefined;
  })
  isActive?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    return undefined;
  })
  isPublished?: boolean;
}
