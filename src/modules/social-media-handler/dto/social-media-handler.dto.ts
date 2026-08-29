import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsNumber, IsEnum, IsBoolean } from 'class-validator';

export class CreateSocialMediaHandlerDto {
  @ApiProperty({ example: 'INSTAGRAM', description: 'Social media platform (INSTAGRAM, FACEBOOK, YOUTUBE, LINKEDIN, TWITTER, etc.)' })
  @IsNotEmpty()
  @IsString()
  platform: string;

  @ApiProperty({ example: '@carefitnessgym', description: 'Account handle or name' })
  @IsNotEmpty()
  @IsString()
  accountName: string;

  @ApiPropertyOptional({ example: 'https://instagram.com/carefitnessgym' })
  @IsOptional()
  @IsString()
  accountUrl?: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Assigned handler / executive name' })
  @IsOptional()
  @IsString()
  handlerName?: string;

  @ApiPropertyOptional({ example: '+91 9876543210' })
  @IsOptional()
  @IsString()
  handlerPhone?: string;

  @ApiPropertyOptional({ example: 'john@handler.com' })
  @IsOptional()
  @IsString()
  handlerEmail?: string;

  @ApiPropertyOptional({ example: 'Content Posting', description: 'Work Type (Content Posting, Reel Creation, Ad Campaign, Graphic Design)' })
  @IsOptional()
  @IsString()
  workType?: string;

  @ApiPropertyOptional({ example: 'ACTIVE', default: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'PAUSED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'Weekly 3 reels and 4 static posts' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.999Z' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ example: 30, default: 30 })
  @IsOptional()
  @IsNumber()
  durationDays?: number;

  @ApiPropertyOptional({ example: 1, description: 'Explicit customer ID when created by Admin/Super Admin' })
  @IsOptional()
  @IsNumber()
  customerId?: number;
}

export class UpdateSocialMediaHandlerDto extends PartialType(CreateSocialMediaHandlerDto) {}

export class QuerySocialMediaHandlerDto {
  @ApiPropertyOptional({ description: 'Search account name, handler name, platform' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by platform' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'Filter by status (ACTIVE, INACTIVE, PAUSED)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by customer ID (Admin only)' })
  @IsOptional()
  customerId?: number | string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number;
}
