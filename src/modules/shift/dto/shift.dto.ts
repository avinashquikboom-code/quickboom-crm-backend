import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ShiftGuidanceDto {
  @ApiPropertyOptional({ example: 'Overtime commences after 9 hours of active work at 1.5x wage.' })
  @IsOptional()
  @IsString()
  overtimeRule?: string;

  @ApiPropertyOptional({ example: 'Punch-in allowed 30 mins prior to shift. Late arrival starts at shift start.' })
  @IsOptional()
  @IsString()
  punchInRule?: string;

  @ApiPropertyOptional({ example: 'Early checkout requires manager authorization.' })
  @IsOptional()
  @IsString()
  punchOutRule?: string;

  @ApiPropertyOptional({ example: '1-hour lunch break between 1:00 PM and 2:00 PM.' })
  @IsOptional()
  @IsString()
  breakPolicy?: string;

  @ApiPropertyOptional({ example: '₹250 night shift allowance with company cab.' })
  @IsOptional()
  @IsString()
  nightShiftAllowance?: string;

  @ApiPropertyOptional({ example: 'Shift swap requires 24h prior notification and mutual consent.' })
  @IsOptional()
  @IsString()
  swapPolicy?: string;

  @ApiPropertyOptional({ example: 'Punch must be within 150m office radius.' })
  @IsOptional()
  @IsString()
  geofenceRequirement?: string;

  @ApiPropertyOptional({ example: 'Contact HR Duty Manager for emergency absences.' })
  @IsOptional()
  @IsString()
  emergencyContactProtocol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateShiftDto {
  @ApiProperty({ example: 'General Morning Shift' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'MGS-01' })
  @IsString()
  code: string;

  @ApiProperty({ example: '09:30 AM' })
  @IsString()
  startTime: string;

  @ApiProperty({ example: '06:30 PM' })
  @IsString()
  endTime: string;

  @ApiPropertyOptional({ example: 9.0 })
  @IsOptional()
  @IsNumber()
  durationHours?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber()
  gracePeriodMinutes?: number;

  @ApiPropertyOptional({ example: 4.5 })
  @IsOptional()
  @IsNumber()
  halfDayThresholdHours?: number;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsNumber()
  breakDurationMinutes?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isNightShift?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isRotational?: boolean;

  @ApiPropertyOptional({ example: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] })
  @IsOptional()
  @IsArray()
  workingDays?: string[];

  @ApiPropertyOptional({ example: '#3B82F6' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: () => ShiftGuidanceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShiftGuidanceDto)
  guidance?: ShiftGuidanceDto;
}

export class UpdateShiftDto extends CreateShiftDto {}

export class UpdateShiftGuidanceDto extends ShiftGuidanceDto {}

export class AssignEmployeesToShiftDto {
  @ApiProperty({ example: [1, 2, 3] })
  @IsArray()
  employeeIds: number[];

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  departmentId?: number;

  @ApiPropertyOptional({ example: '2026-11-23' })
  @IsOptional()
  @IsString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ example: 'Shift rotation' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UnassignEmployeesDto {
  @ApiProperty({ example: [1, 2, 3] })
  @IsArray()
  employeeIds: number[];

  @ApiPropertyOptional({ example: 'Project completed' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class QueryShiftHistoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  employeeId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  shiftId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number;
}
