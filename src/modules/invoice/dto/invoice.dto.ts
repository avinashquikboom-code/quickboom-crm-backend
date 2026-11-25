import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  IsBoolean,
  Min,
  IsIn,
} from 'class-validator';
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

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  subscriptionId?: number;

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

  @ApiPropertyOptional({ example: 0 })
  @IsNumber()
  @IsOptional()
  discount?: number;

  @ApiProperty({ example: 53100 })
  @IsNumber()
  @IsNotEmpty()
  totalAmount: number;

  @ApiPropertyOptional({ enum: InvoiceStatus, example: InvoiceStatus.PENDING })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @ApiPropertyOptional({ example: 'Growth Plan' })
  @IsString()
  @IsOptional()
  planName?: string;

  @ApiPropertyOptional({ example: 'MONTHLY' })
  @IsString()
  @IsOptional()
  billingCycle?: string;

  @ApiPropertyOptional({ example: '2026-12-05' })
  @IsDateString()
  @IsOptional()
  nextInstallmentDate?: string;

  @ApiPropertyOptional({ example: 15000 })
  @IsNumber()
  @IsOptional()
  nextInstallmentAmount?: number;

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

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  issueDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  subTotal?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  taxAmount?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  discount?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  totalAmount?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  planName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  nextInstallmentDate?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  nextInstallmentAmount?: number;
}

export class RecordInvoicePaymentDto {
  @ApiProperty({ example: 15000 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ example: 'OFFLINE', enum: ['ONLINE', 'OFFLINE'] })
  @IsString()
  @IsIn(['ONLINE', 'OFFLINE'])
  paymentMode: 'ONLINE' | 'OFFLINE';

  @ApiProperty({ example: 'BANK_TRANSFER' })
  @IsString()
  @IsNotEmpty()
  paymentMethod: string;

  @ApiPropertyOptional({ example: '2026-11-25T10:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  paymentDate?: string;

  @ApiPropertyOptional({ example: 'UTR123456789' })
  @IsString()
  @IsOptional()
  transactionRef?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  gatewayPaymentId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  gatewayOrderId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  proofUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiPropertyOptional({ example: '2026-12-05' })
  @IsDateString()
  @IsOptional()
  nextInstallmentDate?: string;

  @ApiPropertyOptional({ example: 15000 })
  @IsNumber()
  @IsOptional()
  nextInstallmentAmount?: number;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  pendingVerification?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

export class VerifyInvoicePaymentDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsString()
  @IsIn(['APPROVE', 'REJECT'])
  action: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class RescheduleInstallmentDto {
  @ApiProperty({ example: '2026-12-15' })
  @IsDateString()
  @IsNotEmpty()
  dueDate: string;

  @ApiPropertyOptional({ example: 15000 })
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiProperty({ example: 'Customer requested 10-day extension' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class GeneratePaymentLinkDto {
  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  allowPartial?: boolean;

  @ApiPropertyOptional({ example: 72 })
  @IsNumber()
  @IsOptional()
  expiresInHours?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  requestedAmount?: number;
}

export class CancelInvoiceDto {
  @ApiProperty({ example: 'Duplicate invoice issued by mistake' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class SendInvoiceCommunicationDto {
  @ApiProperty({ enum: ['WHATSAPP', 'EMAIL', 'BOTH'] })
  @IsString()
  @IsIn(['WHATSAPP', 'EMAIL', 'BOTH'])
  channel: 'WHATSAPP' | 'EMAIL' | 'BOTH';

  @ApiProperty({
    enum: [
      'INVOICE_PDF',
      'PAYMENT_RECEIPT',
      'PARTIAL_PAYMENT_CONFIRMATION',
      'FULL_PAYMENT_CONFIRMATION',
      'INSTALLMENT_REMINDER',
      'OVERDUE_REMINDER',
      'RENEWAL_REMINDER',
      'PAYMENT_LINK',
    ],
  })
  @IsString()
  @IsNotEmpty()
  messageType: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  paymentId?: number;
}

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

  get resolvedIds(): (number | string)[] {
    const merged = [...(this.ids ?? []), ...(this.invoiceIds ?? [])];
    return Array.from(new Set(merged));
  }
}

export class BulkDownloadInvoicesDto {
  @ApiProperty({ example: [1, 2, 3], type: [Number] })
  @IsArray()
  ids: (number | string)[];
}
