import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'EMP-101' })
  @IsString()
  @IsNotEmpty()
  employeeCode: string;

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
}
