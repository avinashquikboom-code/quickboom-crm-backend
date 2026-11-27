import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateLeaveDto {
  @ApiPropertyOptional({ example: 1, description: 'Employee ID (optional if authenticated as employee)' })
  @IsNumber()
  @IsOptional()
  employeeId?: number;

  @ApiPropertyOptional({ example: 1, description: 'Leave Type ID' })
  @IsOptional()
  leaveTypeId?: number;

  @ApiPropertyOptional({ example: 'Casual Leave' })
  @IsString()
  @IsOptional()
  leaveTypeName?: string;

  @ApiProperty({ example: '2026-08-25' })
  @IsNotEmpty()
  fromDate: string | Date;

  @ApiProperty({ example: '2026-08-26' })
  @IsNotEmpty()
  toDate: string | Date;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  days?: number;

  @ApiPropertyOptional({ example: 'HALF_DAY', enum: ['FULL_DAY', 'HALF_DAY'] })
  @IsString()
  @IsIn(['FULL_DAY', 'HALF_DAY'])
  @IsOptional()
  durationType?: 'FULL_DAY' | 'HALF_DAY';

  @ApiPropertyOptional({ example: 'FIRST_HALF', enum: ['FIRST_HALF', 'SECOND_HALF'] })
  @IsString()
  @IsIn(['FIRST_HALF', 'SECOND_HALF'])
  @IsOptional()
  halfDaySession?: 'FIRST_HALF' | 'SECOND_HALF';

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isExceptional?: boolean;

  @ApiPropertyOptional({ example: 'Medical emergency approved by HR' })
  @IsString()
  @IsOptional()
  exceptionalReason?: string;

  @ApiPropertyOptional({ example: 'Family function' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class ApproveLeaveDto {
  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isExceptional?: boolean;

  @ApiPropertyOptional({ example: 'Approved as exception by HR manager' })
  @IsString()
  @IsOptional()
  exceptionalReason?: string;
}

export class RejectLeaveDto {
  @ApiPropertyOptional({ example: 'Critical sprint deliverables pending this week.' })
  @IsString()
  @IsOptional()
  rejectionReason?: string;
}

export class AdjustLeaveBalanceDto {
  @ApiProperty({ example: 1, description: 'Leave Type ID' })
  @IsNumber()
  @IsNotEmpty()
  leaveTypeId: number;

  @ApiProperty({
    example: 'ADD',
    enum: ['ADD', 'DEDUCT', 'SET_BALANCE'],
    description: 'Adjustment action type',
  })
  @IsString()
  @IsIn(['ADD', 'DEDUCT', 'SET_BALANCE'])
  @IsNotEmpty()
  adjustmentType: 'ADD' | 'DEDUCT' | 'SET_BALANCE';

  @ApiProperty({ example: 2, description: 'Adjustment amount' })
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  amount: number;

  @ApiProperty({ example: 'Additional leave approved by HR manager for outstanding performance' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
