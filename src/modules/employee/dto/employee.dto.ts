import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateEmployeeDto {
  @ApiPropertyOptional({ example: 'QB0001', description: 'Auto-generated if not provided' })
  @IsString()
  @IsOptional()
  employeeCode?: string;

  @ApiPropertyOptional({ example: true, description: 'Force auto-generation of Employee ID' })
  @IsOptional()
  autoGenerateCode?: boolean;

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

  @ApiPropertyOptional({ example: 'Photographer' })
  @IsString()
  @IsOptional()
  designationName?: string;

  @ApiPropertyOptional({ example: 'Media & Production' })
  @IsString()
  @IsOptional()
  departmentName?: string;

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
  emergencyContact?: any;

  @ApiPropertyOptional()
  @IsOptional()
  managerId?: number;
}

export class UpdateEmployeeDto {
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

  @ApiPropertyOptional({ example: 'Media & Production' })
  @IsString()
  @IsOptional()
  departmentName?: string;

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
  emergencyContact?: any;

  @ApiPropertyOptional()
  @IsOptional()
  managerId?: number;
}
