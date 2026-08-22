import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpsertAttendancePolicyDto {
  @ApiPropertyOptional({ example: 'Standard Attendance Policy' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  officeId?: number | null;

  @ApiPropertyOptional({ example: '09:30' })
  @IsString()
  @IsOptional()
  officeStartTime?: string;

  @ApiPropertyOptional({ example: '18:30' })
  @IsString()
  @IsOptional()
  officeEndTime?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsNumber()
  @IsOptional()
  workingDaysPerWeek?: number;

  @ApiPropertyOptional({ example: 8.0 })
  @IsNumber()
  @IsOptional()
  workingHoursPerDay?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  punchInRequired?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  earlyPunchInAllowed?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  multiplePunchInAllowed?: boolean;

  @ApiPropertyOptional({ example: 15 })
  @IsNumber()
  @IsOptional()
  gracePeriodMinutes?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsNumber()
  @IsOptional()
  lateArrivalThresholdMins?: number;

  @ApiPropertyOptional({ example: 'MARK_LATE' })
  @IsString()
  @IsOptional()
  lateRuleAction?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  punchOutRequired?: boolean;

  @ApiPropertyOptional({ example: 8.0 })
  @IsNumber()
  @IsOptional()
  minWorkingHours?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsNumber()
  @IsOptional()
  earlyCheckoutGraceMinutes?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsNumber()
  @IsOptional()
  earlyCheckoutThresholdMins?: number;

  @ApiPropertyOptional({ example: 'MARK_EARLY' })
  @IsString()
  @IsOptional()
  earlyCheckoutAction?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  autoPunchOut?: boolean;

  @ApiPropertyOptional({ example: 100.0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  fullDayAbsenceDeductionPct?: number;

  @ApiPropertyOptional({ example: 50.0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  halfDayDeductionPct?: number;

  @ApiPropertyOptional({ example: 25.0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  lateArrivalDeductionPct?: number;

  @ApiPropertyOptional({ example: 25.0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  earlyCheckoutDeductionPct?: number;

  @ApiPropertyOptional({ example: 100.0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  breakExcessDeductionPct?: number;

  @ApiPropertyOptional({ example: 4.0 })
  @IsNumber()
  @IsOptional()
  minWorkingHoursForHalfDay?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  overtimeEligible?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  breakAllowed?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  breakRequired?: boolean;

  @ApiPropertyOptional({ example: 60 })
  @IsNumber()
  @IsOptional()
  maxBreakDurationMins?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsNumber()
  @IsOptional()
  minBreakDurationMins?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  maxBreaksPerDay?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsNumber()
  @IsOptional()
  breakGracePeriodMins?: number;

  @ApiPropertyOptional({ example: 'UNPAID' })
  @IsString()
  @IsOptional()
  breakType?: string;

  @ApiPropertyOptional({ example: 'DEDUCT_EXCESS' })
  @IsString()
  @IsOptional()
  breakExcessAction?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  allowBreakExtension?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  officeAttendanceRequired?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  gpsRequired?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  allowOutsideCheckIn?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  allowOutsideCheckOut?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpsertLeavePolicyDto {
  @ApiPropertyOptional({ example: 'Standard Leave Policy' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  officeId?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  allowHalfDay?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  allowBackdatedLeave?: boolean;

  @ApiPropertyOptional({ example: 3 })
  @IsNumber()
  @IsOptional()
  maxBackdatedDays?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  allowFutureLeave?: boolean;

  @ApiPropertyOptional({ example: 90 })
  @IsNumber()
  @IsOptional()
  maxFutureDays?: number;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  allowProbationLeave?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  includeHolidaysInLeave?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  includeWeekendsInLeave?: boolean;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  minNoticePeriodDays?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsNumber()
  @IsOptional()
  maxConsecutiveDays?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  requiresManagerApproval?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  requiresHrApproval?: boolean;

  @ApiPropertyOptional({ example: 3 })
  @IsNumber()
  @IsOptional()
  requiresAttachmentAboveDays?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpsertSalaryPolicyDto {
  @ApiPropertyOptional({ example: 'Standard Salary Policy' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  officeId?: number | null;

  @ApiPropertyOptional({ example: 'MONTHLY' })
  @IsString()
  @IsOptional()
  salaryCycle?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  payrollCycleStartDay?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsNumber()
  @IsOptional()
  workingDaysPerMonth?: number;

  @ApiPropertyOptional({ example: 100.0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  fullDayDeductionPct?: number;

  @ApiPropertyOptional({ example: 50.0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  halfDayDeductionPct?: number;

  @ApiPropertyOptional({ example: 25.0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  lateArrivalDeductionPct?: number;

  @ApiPropertyOptional({ example: 25.0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  earlyCheckoutDeductionPct?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  overtimeEnabled?: boolean;

  @ApiPropertyOptional({ example: 1.5 })
  @IsNumber()
  @IsOptional()
  overtimeMultiplier?: number;

  @ApiPropertyOptional({ example: 'HOURLY_BASE' })
  @IsString()
  @IsOptional()
  overtimeCalculationMethod?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  commissionEnabled?: boolean;

  @ApiPropertyOptional({ example: 'PERCENTAGE' })
  @IsString()
  @IsOptional()
  commissionType?: string;

  @ApiPropertyOptional({ example: 1.0 })
  @IsNumber()
  @IsOptional()
  commissionPercentage?: number;

  @ApiPropertyOptional({ example: 12.0 })
  @IsNumber()
  @IsOptional()
  pfPercent?: number;

  @ApiPropertyOptional({ example: 0.75 })
  @IsNumber()
  @IsOptional()
  esiPercent?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpsertClaimPolicyDto {
  @ApiPropertyOptional({ example: 'Standard Claim Policy' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  officeId?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  claimsEnabled?: boolean;

  @ApiPropertyOptional({ example: 25000.0 })
  @IsNumber()
  @IsOptional()
  maxClaimAmountPerReceipt?: number;

  @ApiPropertyOptional({ example: 100000.0 })
  @IsNumber()
  @IsOptional()
  monthlyClaimLimit?: number;

  @ApiPropertyOptional({ example: 500000.0 })
  @IsNumber()
  @IsOptional()
  annualClaimLimit?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  receiptRequired?: boolean;

  @ApiPropertyOptional({ example: 500.0 })
  @IsNumber()
  @IsOptional()
  receiptRequiredAboveAmount?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  approvalRequired?: boolean;

  @ApiPropertyOptional({ example: 0.0 })
  @IsNumber()
  @IsOptional()
  autoApprovalThreshold?: number;

  @ApiPropertyOptional({
    example: ['TRAVEL', 'FOOD', 'FUEL', 'ACCOMMODATION', 'MEDICAL', 'COMMUNICATION', 'OFFICE_SUPPLIES', 'OTHER'],
  })
  @IsArray()
  @IsOptional()
  allowedCategories?: string[];

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
