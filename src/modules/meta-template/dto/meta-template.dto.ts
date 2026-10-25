import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray, IsInt, Min, Max, IsNumber, IsObject, ValidateIf } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateMetaTemplateDto {
  @ApiProperty({ description: 'Display name for template', example: 'Lead Contacted Notice' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @ApiPropertyOptional({ description: 'Meta technical template name (lowercase_with_underscores)', example: 'lead_stage_contacted' })
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
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === 'undefined' || trimmed === 'null' || trimmed === '' ? undefined : trimmed;
  })
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by category (UTILITY, MARKETING, AUTHENTICATION, ALL)' })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().toUpperCase();
    return trimmed === 'UNDEFINED' || trimmed === 'NULL' || trimmed === '' || trimmed === 'ALL' ? undefined : trimmed;
  })
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter by Meta status (APPROVED, PENDING, REJECTED, ALL)' })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().toUpperCase();
    return trimmed === 'UNDEFINED' || trimmed === 'NULL' || trimmed === '' || trimmed === 'ALL' ? undefined : trimmed;
  })
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by Meta status alias' })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().toUpperCase();
    return trimmed === 'UNDEFINED' || trimmed === 'NULL' || trimmed === '' || trimmed === 'ALL' ? undefined : trimmed;
  })
  @IsString()
  metaStatus?: string;

  @ApiPropertyOptional({ description: 'Filter by language code (en_US, hi_IN, ALL)' })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === 'undefined' || trimmed === 'null' || trimmed === '' || trimmed.toUpperCase() === 'ALL' ? undefined : trimmed;
  })
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Filter by local active status (true, false, ALL)' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return String(value);
    const s = String(value).trim().toLowerCase();
    if (s === 'undefined' || s === 'null' || s === '' || s === 'all') return undefined;
    return s === 'true' ? 'true' : s === 'false' ? 'false' : undefined;
  })
  @IsString()
  isLocalActive?: string;

  @ApiPropertyOptional({ description: 'Filter by local active status alias' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return String(value);
    const s = String(value).trim().toLowerCase();
    if (s === 'undefined' || s === 'null' || s === '' || s === 'all') return undefined;
    return s === 'true' ? 'true' : s === 'false' ? 'false' : undefined;
  })
  @IsString()
  isActive?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'undefined' || value === 'null' || value === '' || value === null || value === undefined) return undefined;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) || parsed < 1 ? 1 : parsed;
  })
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 50 })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'undefined' || value === 'null' || value === '' || value === null || value === undefined) return undefined;
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 1) return 50;
    return Math.min(100, parsed);
  })
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination offset', default: 0 })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'undefined' || value === 'null' || value === '' || value === null || value === undefined) return undefined;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
  })
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ description: 'Template type (e.g. meta, WHATSAPP)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() !== 'undefined' ? value.trim() : undefined))
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Template type alias' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() !== 'undefined' ? value.trim() : undefined))
  @IsString()
  templateType?: string;

  @ApiPropertyOptional({ description: 'Channel alias (e.g. WHATSAPP)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() !== 'undefined' ? value.trim() : undefined))
  @IsString()
  channel?: string;

  @ApiPropertyOptional({ description: 'Provider alias (e.g. META)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() !== 'undefined' ? value.trim() : undefined))
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Sort field' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() !== 'undefined' ? value.trim() : undefined))
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ description: 'Sort order' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() !== 'undefined' ? value.trim().toLowerCase() : undefined))
  @IsString()
  sortOrder?: string;

  @ApiPropertyOptional({ description: 'Sort alias' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() !== 'undefined' ? value.trim() : undefined))
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ description: 'Cache buster' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : undefined))
  @IsString()
  _?: string;
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
  @Type(() => Number)
  @IsNumber({}, { message: 'templateId must be a valid number' })
  templateId?: number;

  @ApiPropertyOptional({ description: 'Meta technical template name' })
  @IsOptional()
  @IsString()
  templateName?: string;

  @ApiPropertyOptional({ description: 'Recipient phone number (E.164 or national format)' })
  @Transform(({ obj, value }) => {
    const val = value !== undefined ? value : obj?.phoneNumber !== undefined ? obj.phoneNumber : obj?.phone;
    return typeof val === 'string' ? val.trim() : val;
  })
  @ValidateIf((o) => !o.phoneNumber && !o.phone)
  @IsNotEmpty({ message: 'Recipient WhatsApp phone number (to) is required' })
  @IsString({ message: 'Recipient phone number must be a string' })
  to?: string;

  @ApiPropertyOptional({ description: 'Alias for recipient phone number' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'Alias for recipient phone number' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Template language code', default: 'en_US' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Key-value mapping of template variable values' })
  @IsOptional()
  @IsObject({ message: 'Template variables must be a key-value object' })
  variables?: Record<string, string>;
}

