import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateMetaTemplateDto {
  @ApiProperty({ description: 'Display name for template', example: 'Lead Contacted Notice' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @ApiProperty({ description: 'Meta technical template name (lowercase_with_underscores)', example: 'lead_stage_contacted' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_')
          .replace(/[^a-z0-9_]/g, '')
      : value,
  )
  templateName: string;

  @ApiPropertyOptional({ description: 'Identifier key for CRM stage mapping', example: 'CONTACTED' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '_') : value))
  key?: string;

  @ApiPropertyOptional({ description: 'Language code supported by Meta', default: 'en_US', example: 'en_US' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : 'en_US'))
  language?: string;

  @ApiPropertyOptional({ description: 'Template category: UTILITY, MARKETING, AUTHENTICATION', default: 'UTILITY' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : 'UTILITY'))
  category?: string;

  @ApiPropertyOptional({ description: 'Meta approval status: APPROVED, PENDING, REJECTED, etc.', default: 'APPROVED' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : 'APPROVED'))
  status?: string;

  @ApiPropertyOptional({ description: 'Meta Template ID from Graph API' })
  @IsOptional()
  @IsString()
  metaTemplateId?: string;

  @ApiPropertyOptional({ description: 'Header component type: NONE, TEXT, IMAGE, DOCUMENT, VIDEO', default: 'NONE' })
  @IsOptional()
  @IsString()
  headerType?: string;

  @ApiPropertyOptional({ description: 'Header content or media reference' })
  @IsOptional()
  @IsString()
  headerContent?: string;

  @ApiProperty({ description: 'Message body text with {{variables}}', example: 'Hi {{leadName}}, this is {{userName}} from {{companyName}}.' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ description: 'Footer text' })
  @IsOptional()
  @IsString()
  footer?: string;

  @ApiPropertyOptional({ description: 'Interactive button configurations (JSON/Array)' })
  @IsOptional()
  buttons?: any;

  @ApiPropertyOptional({ description: 'Supported CRM variable tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variables?: string[];

  @ApiPropertyOptional({ description: 'Whether locally enabled in CRM', default: true })
  @IsOptional()
  @IsBoolean()
  isLocalActive?: boolean;
}

export class UpdateMetaTemplateDto {
  @ApiPropertyOptional({ description: 'Display name for template' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({ description: 'Meta technical template name' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_')
          .replace(/[^a-z0-9_]/g, '')
      : value,
  )
  templateName?: string;

  @ApiPropertyOptional({ description: 'Identifier key for CRM stage mapping' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '_') : value))
  key?: string;

  @ApiPropertyOptional({ description: 'Language code' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Category' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  category?: string;

  @ApiPropertyOptional({ description: 'Meta approval status' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  status?: string;

  @ApiPropertyOptional({ description: 'Meta Template ID from Graph API' })
  @IsOptional()
  @IsString()
  metaTemplateId?: string;

  @ApiPropertyOptional({ description: 'Header component type' })
  @IsOptional()
  @IsString()
  headerType?: string;

  @ApiPropertyOptional({ description: 'Header content' })
  @IsOptional()
  @IsString()
  headerContent?: string;

  @ApiPropertyOptional({ description: 'Message body text' })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({ description: 'Footer text' })
  @IsOptional()
  @IsString()
  footer?: string;

  @ApiPropertyOptional({ description: 'Interactive button configurations' })
  @IsOptional()
  buttons?: any;

  @ApiPropertyOptional({ description: 'Supported CRM variable tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variables?: string[];

  @ApiPropertyOptional({ description: 'Whether locally enabled' })
  @IsOptional()
  @IsBoolean()
  isLocalActive?: boolean;
}

export class QueryMetaTemplateDto {
  @ApiPropertyOptional({ description: 'Search term for name, key, or body' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by category (UTILITY, MARKETING, AUTHENTICATION, ALL)' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter by Meta status (APPROVED, PENDING, REJECTED, ALL)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by language code (en_US, hi_IN, ALL)' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Filter by local active status (true, false, ALL)' })
  @IsOptional()
  isLocalActive?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 50 })
  @IsOptional()
  limit?: number;
}

export class PreviewMetaTemplateDto {
  @ApiPropertyOptional({ description: 'Body text with variable tags' })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({ description: 'Header text' })
  @IsOptional()
  @IsString()
  headerContent?: string;

  @ApiPropertyOptional({ description: 'Template ID to preview' })
  @IsOptional()
  templateId?: number;

  @ApiPropertyOptional({ description: 'Custom variables to interpolate' })
  @IsOptional()
  variables?: Record<string, any>;
}

export class TestSendMetaTemplateDto {
  @ApiPropertyOptional({ description: 'Database ID of the Meta template' })
  @IsOptional()
  templateId?: number;

  @ApiPropertyOptional({ description: 'Meta technical template name' })
  @IsOptional()
  @IsString()
  templateName?: string;

  @ApiProperty({ description: 'Recipient phone number (E.164 or national format)' })
  @IsNotEmpty()
  @IsString()
  to: string;

  @ApiPropertyOptional({ description: 'Template language code', default: 'en_US' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Key-value mapping of template variable values' })
  @IsOptional()
  variables?: Record<string, string>;
}

