import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDesignationDto {
  @ApiProperty({ example: 'Software Engineer' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'SE' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: 1, description: 'Optional department ID this designation belongs to' })
  @IsNumber()
  @IsOptional()
  departmentId?: number;

  @ApiPropertyOptional({ example: 'Core software developer' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 1, description: 'Seniority level (1-10)' })
  @IsNumber()
  @IsOptional()
  level?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Whether staff with this designation have access to CRM mobile navigation' })
  @IsBoolean()
  @IsOptional()
  crmMobileAccess?: boolean;

  @ApiPropertyOptional({ enum: ['EMPLOYEE', 'CUSTOMER'], default: 'EMPLOYEE' })
  @IsOptional()
  @IsIn(['EMPLOYEE', 'CUSTOMER'])
  audience?: 'EMPLOYEE' | 'CUSTOMER';
}

export class UpdateDesignationDto {
  @ApiPropertyOptional({ example: 'Senior Software Engineer' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'SSE' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  departmentId?: number;

  @ApiPropertyOptional({ example: 'Core software developer' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  level?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Whether staff with this designation have access to CRM mobile navigation' })
  @IsBoolean()
  @IsOptional()
  crmMobileAccess?: boolean;

  @ApiPropertyOptional({ enum: ['EMPLOYEE', 'CUSTOMER'] })
  @IsOptional()
  @IsIn(['EMPLOYEE', 'CUSTOMER'])
  audience?: 'EMPLOYEE' | 'CUSTOMER';
}

