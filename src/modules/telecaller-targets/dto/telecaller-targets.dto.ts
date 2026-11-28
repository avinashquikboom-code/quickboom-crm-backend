import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class AssignTelecallerTargetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  employeeId?: number;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  employeeIds?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  departmentId?: number;

  @ApiProperty()
  @IsString()
  metricKey: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  metricLabel?: string;

  @ApiPropertyOptional({ enum: ['DAILY', 'WEEKLY', 'MONTHLY'] })
  @IsOptional()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY'])
  periodType?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  targetValue: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightage?: number;

  @ApiProperty()
  @IsDateString()
  effectiveDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ enum: ['ONE_TIME', 'RECURRING'] })
  @IsOptional()
  @IsIn(['ONE_TIME', 'RECURRING'])
  recurrence?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOverride?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateTelecallerTargetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ enum: ['ONE_TIME', 'RECURRING'] })
  @IsOptional()
  @IsIn(['ONE_TIME', 'RECURRING'])
  recurrence?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOverride?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpsertTelecallerTargetPolicyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  adjustForHalfDayLeave?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  excludeFullDayLeave?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  excludeHolidays?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  excludeWeeklyOff?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoSendOnFinalPunchOut?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emailTemplateKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emailSubjectTemplate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappTemplateName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappLanguageCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  whatsappVariableMapping?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRetryAttempts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  minConnectedCalls?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxConnectedCalls?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rewardsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  rewardPointsPerDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  pointsPerRupee?: number;

  @ApiPropertyOptional({ enum: ['ALL_MANDATORY', 'CALL_TARGET_ONLY'] })
  @IsOptional()
  @IsIn(['ALL_MANDATORY', 'CALL_TARGET_ONLY'])
  rewardEligibilityMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  rewardEffectiveDate?: string;
}

export class AdjustTelecallerRewardDto {
  @ApiProperty()
  @IsInt()
  employeeId: number;

  @ApiProperty()
  @IsString()
  businessDate: string;

  @ApiProperty()
  @IsInt()
  points: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  incentiveAmount?: number;

  @ApiProperty()
  @IsString()
  reason: string;
}

export class ReverseTelecallerRewardDto {
  @ApiProperty()
  @IsString()
  reason: string;
}

export class UpsertRewardSlabsDto {
  @ApiProperty({ type: 'array' })
  @IsArray()
  slabs: Array<{
    label: string;
    minCalls: number;
    maxCalls?: number | null;
    rewardPoints: number;
    sortOrder?: number;
    isActive?: boolean;
  }>;
}

export class RecordCallEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  leadId?: number;

  @ApiProperty()
  @IsString()
  idempotencyKey: string;

  @ApiProperty({ enum: ['OUTGOING', 'CONNECTED', 'MISSED', 'NO_ANSWER', 'BUSY'] })
  @IsIn(['OUTGOING', 'CONNECTED', 'MISSED', 'NO_ANSWER', 'BUSY'])
  callStatus: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVerifiedWebhook?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, any>;
}
