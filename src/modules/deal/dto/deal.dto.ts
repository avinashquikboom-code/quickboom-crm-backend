import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDealDto {
  @ApiProperty({ example: 'Q3 Enterprise CRM Subscription' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'pipeline-uuid' })
  @IsString()
  @IsNotEmpty()
  pipelineId: string;

  @ApiProperty({ example: 'stage-uuid' })
  @IsString()
  @IsNotEmpty()
  stageId: string;

  @ApiProperty({ example: 120000.0 })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiPropertyOptional({ example: 'contact-uuid' })
  @IsString()
  @IsOptional()
  contactId?: string;

  @ApiPropertyOptional({ example: 'company-uuid' })
  @IsString()
  @IsOptional()
  companyId?: string;

  @ApiPropertyOptional({ example: '2026-09-30T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  expectedClosing?: string;

  @ApiPropertyOptional({ example: 75.0 })
  @IsNumber()
  @IsOptional()
  probability?: number;
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
