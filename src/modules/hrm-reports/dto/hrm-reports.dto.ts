import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min, Max, IsIn } from 'class-validator';

export class UpdateHrmReportSettingDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  attendanceEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  leaveEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  salaryEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;

  @ApiPropertyOptional({ example: '18:30' })
  @IsOptional()
  @IsString()
  deliveryTime?: string;

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @IsNumber()
  graceHours?: number;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsNumber()
  maxAttempts?: number;
}

export class TriggerMonthlyReportRunDto {
  @ApiProperty({ example: 2026 })
  @IsNumber()
  @IsNotEmpty()
  year: number;

  @ApiProperty({ example: 11, description: '1-12' })
  @IsNumber()
  @Min(1)
  @Max(12)
  @IsNotEmpty()
  month: number;

  @ApiPropertyOptional({ description: 'Optional single employee ID' })
  @IsOptional()
  @IsNumber()
  employeeId?: number;

  @ApiPropertyOptional({ description: 'Optional department ID filter' })
  @IsOptional()
  @IsNumber()
  departmentId?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  forceRegenerate?: boolean;
}

export class RetryReportDeliveryDto {
  @ApiPropertyOptional({ enum: ['EMAIL', 'WHATSAPP', 'ALL'], default: 'ALL' })
  @IsOptional()
  @IsIn(['EMAIL', 'WHATSAPP', 'ALL'])
  channel?: 'EMAIL' | 'WHATSAPP' | 'ALL';
}

