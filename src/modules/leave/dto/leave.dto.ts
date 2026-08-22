import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

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
