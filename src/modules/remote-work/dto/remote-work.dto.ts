import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { RequestStatus } from '@prisma/client';

export class CreateRemoteRequestDto {
  @ApiPropertyOptional({ example: 1, description: 'Employee ID (optional for employee self-service)' })
  @IsInt()
  @IsOptional()
  employeeId?: number;

  @ApiProperty({ example: '2026-08-25', description: 'Start Date (YYYY-MM-DD)' })
  @IsDateString()
  @IsNotEmpty()
  fromDate: string;

  @ApiProperty({ example: '2026-08-25', description: 'End Date (YYYY-MM-DD)' })
  @IsDateString()
  @IsNotEmpty()
  toDate: string;

  @ApiPropertyOptional({ example: '09:00 AM', description: 'Start Time (e.g. 09:00 AM)' })
  @IsString()
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({ example: '06:00 PM', description: 'End Time (e.g. 06:00 PM)' })
  @IsString()
  @IsOptional()
  endTime?: string;

  @ApiPropertyOptional({ example: 1, description: 'Total Days' })
  @IsInt()
  @Min(1)
  @IsOptional()
  days?: number;

  @ApiPropertyOptional({ example: 'Client meeting nearby home / home emergency' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ example: 'https://storage.../document.pdf' })
  @IsString()
  @IsOptional()
  attachmentUrl?: string;
}

export class RejectRemoteRequestDto {
  @ApiProperty({ example: 'Critical on-site server deployment required today' })
  @IsString()
  @IsNotEmpty()
  rejectionReason: string;
}

export class RemoteRequestQueryDto {
  @ApiPropertyOptional({ enum: ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] })
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  officeId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ enum: ['ALL', 'TODAY', 'THIS_WEEK', 'THIS_MONTH'] })
  @IsOptional()
  dateRange?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  page?: string | number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  limit?: string | number;
}
