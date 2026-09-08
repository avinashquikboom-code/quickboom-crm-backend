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
 *
 * Accepts EITHER:
 *   { "ids": [1, 2, 3] }          ← used by the Admin Panel frontend
 *   { "invoiceIds": [1, 2, 3] }   ← alternative key supported for API consumers
 *
 * The global ValidationPipe (forbidNonWhitelisted: true) requires a typed DTO
 * class — a plain object body without this class is rejected with 400.
 *
 * At least ONE of the two fields must be a non-empty array.
 * The controller merges both fields before passing to the service.
 */
export class BulkDeleteInvoiceDto {
  @ApiProperty({
    example: [1, 2, 3],
    description: 'Array of invoice IDs to soft-delete (primary key field)',
    type: [Number],
    required: false,
  })
  @IsArray({ message: 'ids must be an array' })
  @IsOptional()
  ids?: (number | string)[];

  @ApiProperty({
    example: [1, 2, 3],
    description: 'Alternative field name — same as "ids"',
    type: [Number],
    required: false,
  })
  @IsArray({ message: 'invoiceIds must be an array' })
  @IsOptional()
  invoiceIds?: (number | string)[];

  /**
   * Returns the resolved, deduplicated list of IDs from whichever
   * field(s) the caller provided.  Throws if none are supplied.
   */
  get resolvedIds(): (number | string)[] {
    const merged = [...(this.ids ?? []), ...(this.invoiceIds ?? [])];
    return Array.from(new Set(merged));
  }
}

