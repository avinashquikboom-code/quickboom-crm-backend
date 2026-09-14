import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsInt,
  IsArray,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ConnectSocialAccountDto {
  @ApiProperty({
    description: 'Social platform',
    enum: ['INSTAGRAM', 'FACEBOOK', 'YOUTUBE', 'TIKTOK', 'LINKEDIN'],
    example: 'INSTAGRAM',
  })
  @IsString()
  @IsIn(['INSTAGRAM', 'FACEBOOK', 'YOUTUBE', 'TIKTOK', 'LINKEDIN'])
  platform: string;

  @ApiProperty({ description: 'Display account name', example: 'QuikBoom Official' })
  @IsString()
  @IsNotEmpty()
  accountName: string;

  @ApiPropertyOptional({ description: 'Handle or username', example: '@quikboom_official' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'Profile picture URL' })
  @IsOptional()
  @IsString()
  profilePic?: string;

  @ApiProperty({ description: 'External platform account ID or handle', example: 'act_102938475' })
  @IsString()
  @IsNotEmpty()
  externalAccountId: string;

  @ApiPropertyOptional({ description: 'OAuth access token or authorization code' })
  @IsOptional()
  @IsString()
  accessToken?: string;

  @ApiPropertyOptional({ description: 'OAuth refresh token' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class PublishContentDto {
  @ApiProperty({
    description: 'Array of connected social account IDs to publish to',
    example: [1, 2],
  })
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  accountIds: number[];

  @ApiPropertyOptional({ description: 'Linked AI Generation ID' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  generationId?: number;

  @ApiProperty({ description: 'Post caption and text copy' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: 'List of media URLs to publish' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @ApiPropertyOptional({
    description: 'Optional scheduled timestamp in ISO format. If null, publishes immediately.',
    example: '2026-09-25T14:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  scheduledFor?: string;
}

export class UpdateScheduledPostDto {
  @ApiPropertyOptional({ description: 'Updated scheduled time' })
  @IsOptional()
  @IsString()
  scheduledFor?: string;

  @ApiPropertyOptional({ description: 'Updated post content' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ description: 'Updated media URLs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];
}
