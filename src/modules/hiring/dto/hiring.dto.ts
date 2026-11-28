import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export const RECRUITMENT_STATUSES = [
  'NEW_APPLICATION',
  'PENDING',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_COMPLETED',
  'SELECTED',
  'REJECTED',
  'ON_HOLD',
  'OFFER_SENT',
  'JOINED',
] as const;

export class CreateHiringFormDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  departmentIds?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  fieldConfig?: Record<string, { required?: boolean; visible?: boolean }>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateHiringFormDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  departmentIds?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  fieldConfig?: Record<string, { required?: boolean; visible?: boolean }>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class PublicSubmitApplicationDto {
  @ApiProperty()
  @IsString()
  candidateName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiProperty()
  @IsString()
  mobileNumber: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  departmentId?: number | string;

  @ApiPropertyOptional()
  @IsOptional()
  currentSalary?: number | string;

  @ApiPropertyOptional()
  @IsOptional()
  expectedSalary?: number | string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  experience?: string;

  /** Honeypot spam-protection field; must remain empty */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;
}

export class AdminCreateCandidateDto {
  @ApiProperty()
  @IsString()
  candidateName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiProperty()
  @IsString()
  mobileNumber: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  departmentId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  currentSalary?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedSalary?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  experience?: string;

  @ApiPropertyOptional({ enum: RECRUITMENT_STATUSES })
  @IsOptional()
  @IsIn(RECRUITMENT_STATUSES)
  interviewStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  assignedHrId?: number;
}

export class AdminUpdateCandidateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  candidateName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  departmentId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  currentSalary?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedSalary?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  experience?: string;

  @ApiPropertyOptional({ enum: RECRUITMENT_STATUSES })
  @IsOptional()
  @IsIn(RECRUITMENT_STATUSES)
  interviewStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  assignedHrId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyCandidate?: boolean;
}

export class ScheduleInterviewDto {
  @ApiProperty()
  @IsString()
  interviewDate: string;

  @ApiProperty()
  @IsString()
  interviewTime: string;

  @ApiPropertyOptional({ enum: ['IN_PERSON', 'ONLINE'] })
  @IsOptional()
  @IsIn(['IN_PERSON', 'ONLINE'])
  mode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  meetingLink?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  interviewerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyCandidate?: boolean;
}

export class ConvertCandidateToEmployeeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  departmentId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  designationId?: number;

  @ApiProperty()
  @IsString()
  joiningDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlySalary?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  shiftId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  reportingManagerId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mobileLoginEnabled?: boolean;
}
