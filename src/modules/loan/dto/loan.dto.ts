import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, IsArray, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoanStatus } from '@prisma/client';

export class CreateLoanDto {
  @ApiPropertyOptional({ description: 'Employee ID (optional if authenticated as employee)' })
  @IsNumber()
  @IsOptional()
  employeeId?: number;

  @ApiProperty({ description: 'Requested loan amount' })
  @IsNumber()
  @Min(1)
  loanAmount: number;

  @ApiProperty({ description: 'Loan reason/purpose' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({ description: 'Tenure in months', default: 12 })
  @IsNumber()
  @IsOptional()
  termMonths?: number;

  @ApiPropertyOptional({ description: 'Annual interest rate percentage', default: 0.0 })
  @IsNumber()
  @IsOptional()
  interestRate?: number;

  @ApiPropertyOptional({ description: 'Proposed monthly EMI' })
  @IsNumber()
  @IsOptional()
  monthlyEmi?: number;

  @ApiPropertyOptional({ description: 'Supporting document URLs', type: [String] })
  @IsArray()
  @IsOptional()
  documents?: string[];

  @ApiPropertyOptional({ description: 'Internal notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateLoanDto {
  @ApiPropertyOptional({ description: 'Approved loan amount' })
  @IsNumber()
  @IsOptional()
  approvedAmount?: number;

  @ApiPropertyOptional({ description: 'Monthly EMI' })
  @IsNumber()
  @IsOptional()
  monthlyEmi?: number;

  @ApiPropertyOptional({ description: 'Tenure in months' })
  @IsNumber()
  @IsOptional()
  termMonths?: number;

  @ApiPropertyOptional({ description: 'Remaining balance' })
  @IsNumber()
  @IsOptional()
  remainingBalance?: number;

  @ApiPropertyOptional({ enum: LoanStatus })
  @IsEnum(LoanStatus)
  @IsOptional()
  status?: LoanStatus;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class ApproveLoanDto {
  @ApiPropertyOptional({ description: 'Approved loan amount' })
  @IsNumber()
  @IsOptional()
  approvedAmount?: number;

  @ApiPropertyOptional({ description: 'Monthly EMI' })
  @IsNumber()
  @IsOptional()
  monthlyEmi?: number;

  @ApiPropertyOptional({ description: 'Tenure in months' })
  @IsNumber()
  @IsOptional()
  termMonths?: number;

  @ApiPropertyOptional({ description: 'Start date of EMI deduction' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Approval notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class RejectLoanDto {
  @ApiProperty({ description: 'Reason for rejecting loan request' })
  @IsString()
  @IsNotEmpty()
  rejectionReason: string;
}
