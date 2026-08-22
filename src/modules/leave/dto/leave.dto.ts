import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class CreateLeaveDto {
  @ApiProperty({ example: 1, description: 'Employee ID' })
  @IsNumber()
  @IsNotEmpty()
  employeeId: number;

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

  @ApiPropertyOptional({ example: 'Family function' })
  @IsString()
  @IsOptional()
  reason?: string;
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
