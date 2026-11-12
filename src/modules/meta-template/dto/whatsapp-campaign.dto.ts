import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateWhatsAppCampaignDto {
  @ApiProperty({ example: 'October Lead Nurture' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Approved Meta template database id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  metaTemplateId: number;

  @ApiPropertyOptional({ description: 'Variable mapping for template body/header' })
  @IsOptional()
  @IsObject()
  variableMapping?: Record<string, string>;

  @ApiPropertyOptional({ default: 'LEAD_FILTER' })
  @IsOptional()
  @IsString()
  audienceType?: string;

  @ApiPropertyOptional({ description: 'CRM lead filter payload' })
  @IsOptional()
  @IsObject()
  audienceFilter?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Explicit phone list when audienceType is MANUAL' })
  @IsOptional()
  manualRecipients?: string[];

  @ApiPropertyOptional({ description: 'ISO schedule time; omit to save as draft' })
  @IsOptional()
  @IsString()
  scheduledAt?: string;
}

export class QueryWhatsAppCampaignDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined))
  search?: string;

  @IsOptional()
  @Transform(({ value }) => {
    const s = String(value || 'ALL').trim().toUpperCase();
    return s === 'ALL' ? undefined : s;
  })
  status?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
