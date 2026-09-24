import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CommissionType,
  CommissionConfigStatus,
  CommissionStatus,
} from '@prisma/client';

export class CommissionFilterDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Search by employee, customer, lead name, order ID' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by employee ID' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  employeeId?: number;

  @ApiPropertyOptional({ description: 'Filter by designation ID' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  designationId?: number;

  @ApiPropertyOptional({ enum: CommissionStatus, description: 'Filter by commission status' })
  @IsOptional()
  @IsEnum(CommissionStatus)
  status?: CommissionStatus;

  @ApiPropertyOptional({ description: 'Filter from start date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter to end date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateCommissionStatusDto {
  @ApiProperty({ enum: CommissionStatus, example: CommissionStatus.PAID })
  @IsEnum(CommissionStatus)
  status: CommissionStatus;

  @ApiPropertyOptional({ description: 'Optional payment reference or note' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpsertEmployeeCommissionConfigDto {
  @ApiProperty({ description: 'Employee ID' })
  @Type(() => Number)
  @IsNumber()
  employeeId: number;

  @ApiProperty({ enum: CommissionType, default: CommissionType.PERCENTAGE })
  @IsEnum(CommissionType)
  commissionType: CommissionType;

  @ApiProperty({ description: 'Commission percentage (e.g. 5.0) or fixed amount (e.g. 1000)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  commissionValue: number;

  @ApiPropertyOptional({ enum: CommissionConfigStatus, default: CommissionConfigStatus.ACTIVE })
  @IsOptional()
  @IsEnum(CommissionConfigStatus)
  status?: CommissionConfigStatus;
}

export class UpdateDesignationCommissionDto {
  @ApiProperty({ description: 'Designation ID' })
  @Type(() => Number)
  @IsNumber()
  designationId: number;

  @ApiProperty({ description: 'Enable or disable commission eligibility' })
  @IsBoolean()
  commissionEnabled: boolean;

  @ApiPropertyOptional({ enum: CommissionType, default: CommissionType.PERCENTAGE })
  @IsOptional()
  @IsEnum(CommissionType)
  commissionType?: CommissionType;

  @ApiProperty({ description: 'Commission rate (% or fixed)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  commissionRate: number;
}
