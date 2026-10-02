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
import { Transform } from 'class-transformer';

export const transformOptionalNumber = ({ value }: { value: any }) => {
  if (value === '' || value === 'null' || value === null || value === undefined) return undefined;
  const num = Number(value);
  return isNaN(num) ? undefined : num;
};

export const transformOptionalBoolean = ({ value }: { value: any }) => {
  if (value === '' || value === 'null' || value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return Boolean(value);
};

export class UpsertAttendancePolicyDto {
  // Safe metadata fields passed by client state
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  id?: any;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  customerId?: any;

  @ApiPropertyOptional()
  @IsOptional()
  createdAt?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedAt?: any;

  @ApiPropertyOptional()
  @IsOptional()
  createdById?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedById?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedByName?: any;

  @ApiPropertyOptional()
  @IsOptional()
  customer?: any;

  @ApiPropertyOptional()
  @IsOptional()
  office?: any;

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
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  workingDaysPerWeek?: number;

  @ApiPropertyOptional({ example: 8.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  workingHoursPerDay?: number;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  punchInRequired?: boolean;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  earlyPunchInAllowed?: boolean;

  @ApiPropertyOptional({ example: false })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  multiplePunchInAllowed?: boolean;

  @ApiPropertyOptional({ example: 15 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  gracePeriodMinutes?: number;

  @ApiPropertyOptional({ example: 30 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  lateArrivalThresholdMins?: number;

  @ApiPropertyOptional({ example: 'MARK_LATE' })
  @IsString()
  @IsOptional()
  lateRuleAction?: string;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  punchOutRequired?: boolean;

  @ApiPropertyOptional({ example: 8.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  minWorkingHours?: number;

  @ApiPropertyOptional({ example: 15 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  earlyCheckoutGraceMinutes?: number;

  @ApiPropertyOptional({ example: 30 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  earlyCheckoutThresholdMins?: number;

  @ApiPropertyOptional({ example: 'MARK_EARLY' })
  @IsString()
  @IsOptional()
  earlyCheckoutAction?: string;

  @ApiPropertyOptional({ example: false })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  autoPunchOut?: boolean;

  @ApiPropertyOptional({ example: 100.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  fullDayAbsenceDeductionPct?: number;

  @ApiPropertyOptional({ example: 50.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  halfDayDeductionPct?: number;

  @ApiPropertyOptional({ example: 25.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  lateArrivalDeductionPct?: number;

  @ApiPropertyOptional({ example: 25.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  earlyCheckoutDeductionPct?: number;

  @ApiPropertyOptional({ example: 100.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  breakExcessDeductionPct?: number;

  @ApiPropertyOptional({ example: 4.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  minWorkingHoursForHalfDay?: number;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  overtimeEligible?: boolean;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  breakAllowed?: boolean;

  @ApiPropertyOptional({ example: false })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  breakRequired?: boolean;

  @ApiPropertyOptional({ example: 60 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  maxBreakDurationMins?: number;

  @ApiPropertyOptional({ example: 15 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  minBreakDurationMins?: number;

  @ApiPropertyOptional({ example: 2 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  maxBreaksPerDay?: number;

  @ApiPropertyOptional({ example: 5 })
  @Transform(transformOptionalNumber)
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
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  allowBreakExtension?: boolean;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  officeAttendanceRequired?: boolean;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  gpsRequired?: boolean;

  @ApiPropertyOptional({ example: false })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  allowOutsideCheckIn?: boolean;

  @ApiPropertyOptional({ example: false })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  allowOutsideCheckOut?: boolean;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpsertLeavePolicyDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  id?: any;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  customerId?: any;

  @ApiPropertyOptional()
  @IsOptional()
  createdAt?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedAt?: any;

  @ApiPropertyOptional()
  @IsOptional()
  createdById?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedById?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedByName?: any;

  @ApiPropertyOptional()
  @IsOptional()
  customer?: any;

  @ApiPropertyOptional()
  @IsOptional()
  office?: any;

  @ApiPropertyOptional({ example: 'Standard Leave Policy' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  officeId?: number | null;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  allowHalfDay?: boolean;

  @ApiPropertyOptional({ example: false })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  allowBackdatedLeave?: boolean;

  @ApiPropertyOptional({ example: 3 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  maxBackdatedDays?: number;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  allowFutureLeave?: boolean;

  @ApiPropertyOptional({ example: 90 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  maxFutureDays?: number;

  @ApiPropertyOptional({ example: false })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  allowProbationLeave?: boolean;

  @ApiPropertyOptional({ example: false })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  includeHolidaysInLeave?: boolean;

  @ApiPropertyOptional({ example: false })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  includeWeekendsInLeave?: boolean;

  @ApiPropertyOptional({ example: 2 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  minNoticePeriodDays?: number;

  @ApiPropertyOptional({ example: 10 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  maxConsecutiveDays?: number;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  requiresManagerApproval?: boolean;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  requiresHrApproval?: boolean;

  @ApiPropertyOptional({ example: 3 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  requiresAttachmentAboveDays?: number;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpsertSalaryPolicyDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  id?: any;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  customerId?: any;

  @ApiPropertyOptional()
  @IsOptional()
  createdAt?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedAt?: any;

  @ApiPropertyOptional()
  @IsOptional()
  createdById?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedById?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedByName?: any;

  @ApiPropertyOptional()
  @IsOptional()
  customer?: any;

  @ApiPropertyOptional()
  @IsOptional()
  office?: any;

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
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  payrollCycleStartDay?: number;

  @ApiPropertyOptional({ example: 30 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  workingDaysPerMonth?: number;

  @ApiPropertyOptional({ example: 100.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  fullDayDeductionPct?: number;

  @ApiPropertyOptional({ example: 50.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  halfDayDeductionPct?: number;

  @ApiPropertyOptional({ example: 25.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  lateArrivalDeductionPct?: number;

  @ApiPropertyOptional({ example: 25.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  earlyCheckoutDeductionPct?: number;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  overtimeEnabled?: boolean;

  @ApiPropertyOptional({ example: 1.5 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  overtimeMultiplier?: number;

  @ApiPropertyOptional({ example: 'HOURLY_BASE' })
  @IsString()
  @IsOptional()
  overtimeCalculationMethod?: string;

  @ApiPropertyOptional({ example: false })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  commissionEnabled?: boolean;

  @ApiPropertyOptional({ example: 'PERCENTAGE' })
  @IsString()
  @IsOptional()
  commissionType?: string;

  @ApiPropertyOptional({ example: 1.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  commissionPercentage?: number;

  @ApiPropertyOptional({ example: 12.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  pfPercent?: number;

  @ApiPropertyOptional({ example: 0.75 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  esiPercent?: number;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpsertClaimPolicyDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  id?: any;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  customerId?: any;

  @ApiPropertyOptional()
  @IsOptional()
  createdAt?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedAt?: any;

  @ApiPropertyOptional()
  @IsOptional()
  createdById?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedById?: any;

  @ApiPropertyOptional()
  @IsOptional()
  updatedByName?: any;

  @ApiPropertyOptional()
  @IsOptional()
  customer?: any;

  @ApiPropertyOptional()
  @IsOptional()
  office?: any;

  @ApiPropertyOptional({ example: 'Standard Claim Policy' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  officeId?: number | null;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  claimsEnabled?: boolean;

  @ApiPropertyOptional({ example: 25000.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  maxClaimAmountPerReceipt?: number;

  @ApiPropertyOptional({ example: 100000.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  monthlyClaimLimit?: number;

  @ApiPropertyOptional({ example: 500000.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  annualClaimLimit?: number;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  receiptRequired?: boolean;

  @ApiPropertyOptional({ example: 500.0 })
  @Transform(transformOptionalNumber)
  @IsNumber()
  @IsOptional()
  receiptRequiredAboveAmount?: number;

  @ApiPropertyOptional({ example: true })
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  approvalRequired?: boolean;

  @ApiPropertyOptional({ example: 0.0 })
  @Transform(transformOptionalNumber)
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
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
