import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClaimStatus } from '@prisma/client';

export class CreateClaimDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsNumber()
  @IsNotEmpty()
  employeeId: number;

  @ApiProperty({ description: 'Expense category', example: 'TRAVEL' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ description: 'Claim amount' })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ description: 'Expense description' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ description: 'Expense date' })
  @IsString()
  @IsOptional()
  claimDate?: string;

  @ApiPropertyOptional({ description: 'Receipt document / image URL' })
  @IsString()
  @IsOptional()
  receiptUrl?: string;
}

export class UpdateClaimDto {
  @ApiPropertyOptional({ description: 'Expense category' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Claim amount' })
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional({ description: 'Approved amount' })
  @IsNumber()
  @IsOptional()
  approvedAmount?: number;

  @ApiPropertyOptional({ description: 'Expense description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Receipt URL' })
  @IsString()
  @IsOptional()
  receiptUrl?: string;

  @ApiPropertyOptional({ enum: ClaimStatus })
  @IsEnum(ClaimStatus)
  @IsOptional()
  status?: ClaimStatus;
}

export class ApproveClaimDto {
  @ApiProperty({ description: 'Approved claim reimbursement amount' })
  @IsNumber()
  @Min(1)
  approvedAmount: number;

  @ApiPropertyOptional({ description: 'Approval comments/notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class RejectClaimDto {
  @ApiProperty({ description: 'Reason for rejecting claim' })
  @IsString()
  @IsNotEmpty()
  rejectionReason: string;
}

export class PayClaimDto {
  @ApiPropertyOptional({ description: 'Payment reference or notes' })
  @IsString()
  @IsOptional()
  paymentReference?: string;
}
