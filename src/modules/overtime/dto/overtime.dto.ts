import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const TYPES = ['REGULAR', 'WEEKEND', 'HOLIDAY', 'NIGHT_SHIFT'];
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const PAYROLL = ['NOT_PROCESSED', 'READY_FOR_PAYROLL', 'PROCESSED', 'PAID'];

export class CreateOvertimeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  employeeId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  attendanceId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shiftId?: number;

  @ApiProperty({ example: '2026-11-09' })
  @IsString()
  overtimeDate: string;

  @ApiProperty({ example: '18:30' })
  @IsString()
  startTime: string;

  @ApiProperty({ example: '20:30' })
  @IsString()
  endTime: string;

  @ApiProperty({ enum: TYPES })
  @IsIn(TYPES)
  overtimeType: string;

  @ApiProperty()
  @IsString()
  reason: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeNotes?: string;
}

export class ApproveOvertimeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  approvedMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  managerNotes?: string;
}

export class RejectOvertimeDto {
  @ApiProperty()
  @IsString()
  rejectionReason: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  managerNotes?: string;
}

export class CancelOvertimeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  managerNotes?: string;
}

export class OvertimeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  departmentId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  designationId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: TYPES })
  @IsOptional()
  @IsIn(TYPES)
  overtimeType?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @ApiPropertyOptional({ enum: PAYROLL })
  @IsOptional()
  @IsIn(PAYROLL)
  payrollStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['overtimeDate', 'createdAt', 'totalMinutes', 'calculatedAmount', 'status'])
  sortBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class UpdateOvertimeSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxDailyMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxWeeklyMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  regularMultiplier?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  weekendMultiplier?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  holidayMultiplier?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  nightShiftMultiplier?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoCalculate?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  applicableEmployeeTypes?: string[];
}
