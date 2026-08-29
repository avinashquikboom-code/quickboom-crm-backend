import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { InvoiceStatus } from '@prisma/client';

export class CreateInvoiceDto {
  @ApiProperty({ example: 'INV-2026-001' })
  @IsString()
  @IsNotEmpty()
  invoiceNo: string;

  @ApiProperty({ example: 1 })
  @IsNotEmpty()
  contactId: number | string;

  @ApiProperty({ example: '2026-08-21T00:00:00.000Z' })
  @IsDateString()
  issueDate: string;

  @ApiProperty({ example: '2026-09-21T00:00:00.000Z' })
  @IsDateString()
  dueDate: string;

  @ApiProperty({ example: 45000 })
  @IsNumber()
  subTotal: number;

  @ApiProperty({ example: 8100 })
  @IsNumber()
  taxAmount: number;

  @ApiProperty({ example: 53100 })
  @IsNumber()
  totalAmount: number;

  @ApiPropertyOptional({ example: 'Monthly SSM Retainer Invoice' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateInvoiceDto {
  @ApiPropertyOptional({ enum: InvoiceStatus, example: InvoiceStatus.PAID })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;
}
