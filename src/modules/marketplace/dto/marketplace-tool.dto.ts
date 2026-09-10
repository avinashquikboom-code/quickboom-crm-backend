import { IsString, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMarketplaceToolDto {
  @ApiProperty({ description: 'Title of the marketplace tool', example: 'WhatsApp Marketing Tool' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: 'Optional subtitle', example: 'Campaigns & Automation' })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiPropertyOptional({ description: 'Tool description', example: 'Bulk messaging, auto-replies, campaigns.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Icon identifier or image URL', example: 'whatsapp' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ description: 'Tool category', example: 'GROWTH_TOOLS', default: 'GROWTH_TOOLS' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Internal app route', example: '/customer/social-media-work' })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiPropertyOptional({ description: 'External URL if tool is external', example: 'https://tools.quikboom.com/wa' })
  @IsOptional()
  @IsString()
  externalUrl?: string;

  @ApiPropertyOptional({ description: 'Badge text', example: 'POPULAR' })
  @IsOptional()
  @IsString()
  badge?: string;

  @ApiPropertyOptional({ description: 'Sort display order', example: 1, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Active status', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Published status', default: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateMarketplaceToolDto {
  @ApiPropertyOptional({ description: 'Title of the marketplace tool' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Optional subtitle' })
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiPropertyOptional({ description: 'Tool description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Icon identifier or image URL' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ description: 'Tool category' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Internal app route' })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiPropertyOptional({ description: 'External URL' })
  @IsOptional()
  @IsString()
  externalUrl?: string;

  @ApiPropertyOptional({ description: 'Badge text' })
  @IsOptional()
  @IsString()
  badge?: string;

  @ApiPropertyOptional({ description: 'Sort display order' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Published status' })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
