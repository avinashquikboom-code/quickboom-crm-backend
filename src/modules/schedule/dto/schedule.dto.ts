import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { ScheduleStatus } from '@prisma/client';

export class CreateScheduleDto {
  

  

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  planId?: number;

  @ApiProperty({ example: 9, description: 'Month 1-12' })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2020)
  @Max(2100)
  year: number;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-09-30T23:59:59.000Z' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ enum: ScheduleStatus, default: ScheduleStatus.PLANNED })
  @IsEnum(ScheduleStatus)
  @IsOptional()
  status?: ScheduleStatus;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  assignedEmployeeId?: number;

  @ApiPropertyOptional({ example: 'Social Media & Ads Execution' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Monthly deliverable checklist' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional({ enum: ScheduleStatus })
  @IsEnum(ScheduleStatus)
  @IsOptional()
  status?: ScheduleStatus;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  assignedEmployeeId?: number;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.000Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ example: 'Updated title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated deliverable notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class GenerateScheduleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  assignedEmployeeId?: number;

  @ApiPropertyOptional({ example: 12, description: 'Duration in months' })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(120)
  duration?: number;

  @ApiPropertyOptional({ example: '2026-08-20T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;
}
