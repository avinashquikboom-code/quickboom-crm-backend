import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsArray, IsIn } from 'class-validator';

export enum SendDetailsCategory {
  COMPANY_PROFILE = 'COMPANY_PROFILE',
  SERVICE_CATALOGUE = 'SERVICE_CATALOGUE',
  PRICING_QUOTATION = 'PRICING_QUOTATION',
  PACKAGES_PLANS = 'PACKAGES_PLANS',
  PORTFOLIO_PROJECTS = 'PORTFOLIO_PROJECTS',
}

export const SEND_DETAILS_DEFAULT_CATEGORIES = [
  {
    category: SendDetailsCategory.COMPANY_PROFILE,
    title: 'Company Profile',
    description: 'Company overview, business intro, core services and leadership highlights.',
    sortOrder: 1,
  },
  {
    category: SendDetailsCategory.SERVICE_CATALOGUE,
    title: 'Service / Product Catalogue',
    description: 'Complete listing of commercial offerings, features, specifications and deliverables.',
    sortOrder: 2,
  },
  {
    category: SendDetailsCategory.PRICING_QUOTATION,
    title: 'Pricing / Quotation',
    description: 'Standard pricing structure, commercial quotation guidelines, and tax specifications.',
    sortOrder: 3,
  },
  {
    category: SendDetailsCategory.PACKAGES_PLANS,
    title: 'Packages and Plans',
    description: 'Tiered subscription and service packages with feature comparisons.',
    sortOrder: 4,
  },
  {
    category: SendDetailsCategory.PORTFOLIO_PROJECTS,
    title: 'Portfolio / Previous Projects',
    description: 'Case studies, project photographs, recent client outcomes, and proof of work.',
    sortOrder: 5,
  },
];

export class CreateSendDetailsDocumentDto {
  @ApiProperty({ enum: SendDetailsCategory })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ description: 'Display title of document' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ description: 'Description or highlights' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Public or secure URL of the file' })
  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @ApiPropertyOptional({ description: 'Original file name' })
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiPropertyOptional({ description: 'File size in bytes' })
  @IsOptional()
  @IsNumber()
  fileSize?: number;

  @ApiPropertyOptional({ description: 'MIME type, defaults to application/pdf' })
  @IsOptional()
  @IsString()
  fileType?: string;

  @ApiPropertyOptional({ description: 'Version label, e.g. 1.0' })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class UpdateSendDetailsDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fileUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fileSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fileType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class UpdateSendDetailsConfigDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isAutomationEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappTemplateName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emailSubject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emailBody?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  activeCategories?: string[];
}

export class ManualSendDetailsDto {
  @ApiProperty({ description: 'Channels to send through', example: ['WHATSAPP', 'EMAIL'] })
  @IsArray()
  @IsNotEmpty()
  channels: ('WHATSAPP' | 'EMAIL')[];

  @ApiPropertyOptional({ description: 'Selected document IDs. If omitted, sends all active documents' })
  @IsOptional()
  @IsArray()
  documentIds?: number[];

  @ApiPropertyOptional({ description: 'Optional custom message or note' })
  @IsOptional()
  @IsString()
  customNote?: string;
}

export class RetryDeliveryDto {
  @ApiPropertyOptional({ enum: ['WHATSAPP', 'EMAIL', 'ALL'], default: 'ALL' })
  @IsOptional()
  @IsIn(['WHATSAPP', 'EMAIL', 'ALL'])
  channel?: 'WHATSAPP' | 'EMAIL' | 'ALL';
}

