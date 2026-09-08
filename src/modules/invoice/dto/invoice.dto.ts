import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsArray, ArrayNotEmpty } from 'class-validator';
import { InvoiceStatus } from '@prisma/client';

export class CreateInvoiceDto {
  @ApiPropertyOptional({ example: 'INV-2026-001' })
  @IsString()
  @IsOptional()
  invoiceNo?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  customerId?: number | string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  contactId?: number | string;

  @ApiPropertyOptional({ example: '2026-08-21T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  issueDate?: string;

  @ApiPropertyOptional({ example: '2026-09-21T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional({ example: 45000 })
  @IsNumber()
  @IsOptional()
  subTotal?: number;

  @ApiPropertyOptional({ example: 8100 })
  @IsNumber()
  @IsOptional()
  taxAmount?: number;

  @ApiProperty({ example: 53100 })
  @IsNumber()
  @IsNotEmpty()
  totalAmount: number;

  @ApiPropertyOptional({ enum: InvoiceStatus, example: InvoiceStatus.PENDING })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

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

/**
 * DTO for POST /invoices/bulk-delete
 * The global ValidationPipe (forbidNonWhitelisted: true) requires a typed DTO
 * class — a plain object body would be rejected with 400.
 */
export class BulkDeleteInvoiceDto {
  @ApiProperty({
    example: [1, 2, 3],
    description: 'Array of invoice IDs to permanently soft-delete',
    type: [Number],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'ids must contain at least one invoice ID' })
  @IsNotEmpty({ each: true })
  ids: (number | string)[];
}
