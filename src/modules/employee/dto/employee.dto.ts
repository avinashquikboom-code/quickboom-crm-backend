import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateEmployeeDto {
  // employeeCode is intentionally NOT accepted from the client.
  // The backend always generates the next sequential QB-prefixed ID
  // inside a database transaction (concurrency-safe).

  @ApiProperty({ example: 'Rahul' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Sharma' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'rahul.sharma@quikboom.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: '+91 98765 11111' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 1, description: 'Master Department ID' })
  @IsOptional()
  departmentId?: number;

  @ApiPropertyOptional({ example: 'Media & Production' })
  @IsString()
  @IsOptional()
  departmentName?: string;

  @ApiPropertyOptional({ example: 1, description: 'Master Designation ID' })
  @IsOptional()
  designationId?: number;

  @ApiPropertyOptional({ example: 'Photographer' })
  @IsString()
  @IsOptional()
  designationName?: string;

  @ApiPropertyOptional({ example: 1, description: 'Master Office / Branch ID for attendance geo-fence' })
  @IsOptional()
  officeId?: number;

  @ApiPropertyOptional({ example: 1, description: 'Master Shift ID' })
  @IsOptional()
  shiftId?: number;

  @ApiPropertyOptional({ example: 'Head Office' })
  @IsString()
  @IsOptional()
  officeName?: string;

  @ApiPropertyOptional({ example: 'Head Office' })
  @IsString()
  @IsOptional()
  branch?: string;

  @ApiPropertyOptional({ enum: ['COMPANY', 'FREELANCER'], example: 'COMPANY' })
  @IsOptional()
  @IsEnum(['COMPANY', 'FREELANCER'], { message: 'employeeType must be either COMPANY or FREELANCER' })
  employeeType?: 'COMPANY' | 'FREELANCER';

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'FULL_TIME' })
  @IsString()
  @IsOptional()
  employmentType?: string;

  @ApiPropertyOptional({ example: 'Male' })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  dob?: string | Date;

  @ApiPropertyOptional()
  @IsOptional()
  joiningDate?: string | Date;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'ACTIVE' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  documents?: any;

  @ApiPropertyOptional()
  @IsOptional()
  bankDetails?: any;

  @ApiPropertyOptional()
  @IsOptional()
  salaryStructure?: any;

  @ApiPropertyOptional()
  @IsOptional()
  emergencyContact?: any;

  @ApiPropertyOptional()
  @IsOptional()
  managerId?: number;

  @ApiPropertyOptional({ example: true, description: 'Allow employee mobile application login' })
  @IsOptional()
  mobileLoginEnabled?: boolean;

  @ApiPropertyOptional({ example: 'Secret@123', description: 'Initial password for mobile app login' })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({ example: 'Secret@123', description: 'Confirm password for validation' })
  @IsString()
  @IsOptional()
  confirmPassword?: string;
}

export class UpdateEmployeeDto {
  // employeeCode and autoGenerateCode are intentionally ignored on update.
  // Employee ID is immutable after creation.

  @ApiPropertyOptional({ example: true, description: 'Allow employee mobile application login' })
  @IsOptional()
  mobileLoginEnabled?: boolean;

  @ApiPropertyOptional({ example: 'NewSecret@123', description: 'Optional new password for mobile app' })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({ example: 'NewSecret@123', description: 'Confirm new password' })
  @IsString()
  @IsOptional()
  confirmPassword?: string;

  @ApiPropertyOptional({ example: 'Rahul' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Sharma' })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({ example: 'rahul.sharma@quikboom.com' })
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+91 98765 11111' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'ACTIVE' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 1, description: 'Master Office / Branch ID for attendance geo-fence' })
  @IsOptional()
  officeId?: number;

  @ApiPropertyOptional({ example: 1, description: 'Master Shift ID' })
  @IsOptional()
  shiftId?: number;

  @ApiPropertyOptional({ example: 'Head Office' })
  @IsString()
  @IsOptional()
  officeName?: string;

  @ApiPropertyOptional({ example: 'Head Office' })
  @IsString()
  @IsOptional()
  branch?: string;

  @ApiPropertyOptional({ example: 'FULL_TIME' })
  @IsString()
  @IsOptional()
  employmentType?: string;

  @ApiPropertyOptional({ example: 'Male' })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  dob?: string | Date;

  @ApiPropertyOptional()
  @IsOptional()
  joiningDate?: string | Date;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 1, description: 'Master Department ID' })
  @IsOptional()
  departmentId?: number;

  @ApiPropertyOptional({ example: 'Media & Production' })
  @IsString()
  @IsOptional()
  departmentName?: string;

  @ApiPropertyOptional({ example: 1, description: 'Master Designation ID' })
  @IsOptional()
  designationId?: number;

  @ApiPropertyOptional({ example: 'Senior Specialist' })
  @IsString()
  @IsOptional()
  designationName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  documents?: any;

  @ApiPropertyOptional()
  @IsOptional()
  bankDetails?: any;

  @ApiPropertyOptional()
  @IsOptional()
  salaryStructure?: any;

  @ApiPropertyOptional()
  @IsOptional()
  emergencyContact?: any;

  @ApiPropertyOptional()
  @IsOptional()
  managerId?: number;

  @ApiPropertyOptional({ enum: ['COMPANY', 'FREELANCER'], example: 'COMPANY' })
  @IsOptional()
  @IsEnum(['COMPANY', 'FREELANCER'], { message: 'employeeType must be either COMPANY or FREELANCER' })
  employeeType?: 'COMPANY' | 'FREELANCER';

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsString()
  @IsOptional()
  city?: string;
}
