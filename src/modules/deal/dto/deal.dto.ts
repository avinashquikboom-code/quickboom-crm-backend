import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDealDto {
  @ApiProperty({ example: 'Q3 Enterprise CRM Subscription' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  pipelineId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  stageId?: string;

  @ApiProperty({ example: 120000.0 })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  contactId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  companyId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  leadId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  assignedToId?: string;

  @ApiPropertyOptional({ example: '2026-09-30T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  expectedClosing?: string;

  @ApiPropertyOptional({ example: 75.0 })
  @IsNumber()
  @IsOptional()
  probability?: number;

  @ApiPropertyOptional({ example: 'CRM' })
  @IsString()
  @IsOptional()
  source?: string;

  @ApiPropertyOptional({ example: 'INR' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ example: 'Enterprise cloud solution deal for 500 licenses.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'Client requested quarterly invoicing.' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateDealDto extends CreateDealDto {
  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isWon?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isLost?: boolean;

  @ApiPropertyOptional({ example: 'Competitor price match' })
  @IsString()
  @IsOptional()
  lostReason?: string;
}

export class UpdateDealStageDto {
  @ApiProperty({ example: '1' })
  @IsString()
  @IsNotEmpty()
  stageId: string;

  @ApiPropertyOptional({ example: 80 })
  @IsNumber()
  @IsOptional()
  probability?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isWon?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isLost?: boolean;

  @ApiPropertyOptional({ example: 'Client agreed to proposal terms.' })
  @IsString()
  @IsOptional()
  notes?: string;
}
