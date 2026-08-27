import { IsNotEmpty, IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SubscriptionBillingCycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum PaymentOption {
  FULL = 'FULL',
  ADVANCE = 'ADVANCE',
  BALANCE = 'BALANCE',
}

export class CreateRazorpayOrderDto {
  @ApiProperty({ example: 1, description: 'Plan ID from database' })
  @IsNotEmpty()
  planId: number | string;

  @ApiPropertyOptional({ enum: SubscriptionBillingCycle, default: SubscriptionBillingCycle.MONTHLY })
  @IsOptional()
  @IsEnum(SubscriptionBillingCycle)
  billingCycle?: SubscriptionBillingCycle;

  @ApiPropertyOptional({ enum: PaymentOption, default: PaymentOption.FULL, description: 'FULL (100%), ADVANCE (50%), or BALANCE (remaining 50%)' })
  @IsOptional()
  @IsString()
  paymentOption?: string;

  @ApiPropertyOptional({ example: 101, description: 'Optional Subscription ID when paying balance' })
  @IsOptional()
  subscriptionId?: number | string;

  @ApiPropertyOptional({ example: 'INR', default: 'INR' })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class VerifyRazorpayPaymentDto {
  @ApiProperty({ example: 'order_NxXXXXXXXXXXXX' })
  @IsNotEmpty()
  @IsString()
  razorpay_order_id: string;

  @ApiProperty({ example: 'pay_NxXXXXXXXXXXXX' })
  @IsNotEmpty()
  @IsString()
  razorpay_payment_id: string;

  @ApiProperty({ example: 'signature_hash_hex' })
  @IsNotEmpty()
  @IsString()
  razorpay_signature: string;

  @ApiProperty({ example: 1, description: 'Plan ID purchased' })
  @IsNotEmpty()
  planId: number | string;

  @ApiPropertyOptional({ enum: SubscriptionBillingCycle, default: SubscriptionBillingCycle.MONTHLY })
  @IsOptional()
  @IsEnum(SubscriptionBillingCycle)
  billingCycle?: SubscriptionBillingCycle;

  @ApiPropertyOptional({ enum: PaymentOption, default: PaymentOption.FULL })
  @IsOptional()
  @IsString()
  paymentOption?: string;

  @ApiPropertyOptional({ example: 101, description: 'Subscription ID if paying balance' })
  @IsOptional()
  subscriptionId?: number | string;
}

export class CreateOfflinePaymentDto {
  @ApiProperty({ example: 1, description: 'Plan ID to purchase offline' })
  @IsNotEmpty()
  planId: number | string;

  @ApiPropertyOptional({ enum: SubscriptionBillingCycle, default: SubscriptionBillingCycle.MONTHLY })
  @IsOptional()
  @IsEnum(SubscriptionBillingCycle)
  billingCycle?: SubscriptionBillingCycle;

  @ApiPropertyOptional({ enum: PaymentOption, default: PaymentOption.FULL })
  @IsOptional()
  @IsString()
  paymentOption?: string;

  @ApiPropertyOptional({ example: 101, description: 'Subscription ID if paying balance' })
  @IsOptional()
  subscriptionId?: number | string;

  @ApiPropertyOptional({ example: 'BANK_TRANSFER', description: 'Offline payment method' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 'NEFT-123456789', description: 'Bank transaction reference or receipt number' })
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @ApiPropertyOptional({ example: 'Payment made via HDFC Bank transfer', description: 'Notes or instructions' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class SendPaymentReminderDto {
  @ApiProperty({ example: 101, description: 'Target Customer ID' })
  @IsNotEmpty()
  customerId: number | string;

  @ApiPropertyOptional({ example: 501, description: 'Target Subscription ID' })
  @IsOptional()
  subscriptionId?: number | string;

  @ApiPropertyOptional({ example: 'Your balance payment is due in 3 days.', description: 'Custom reminder note' })
  @IsOptional()
  @IsString()
  customMessage?: string;
}

export class UpdatePaymentSettingsDto {
  @ApiPropertyOptional({ example: true, description: 'Enable or disable Razorpay payment gateway' })
  @IsOptional()
  razorpayEnabled?: boolean;

  @ApiPropertyOptional({ example: 'TEST', description: 'Payment environment mode (TEST or LIVE)' })
  @IsOptional()
  @IsString()
  paymentMode?: 'TEST' | 'LIVE';

  @ApiPropertyOptional({ example: 'rzp_test_...', description: 'Razorpay Test Key ID' })
  @IsOptional()
  @IsString()
  razorpayTestKeyId?: string;

  @ApiPropertyOptional({ example: 'secret_...', description: 'Razorpay Test Key Secret' })
  @IsOptional()
  @IsString()
  razorpayTestKeySecret?: string;

  @ApiPropertyOptional({ example: 'rzp_live_...', description: 'Razorpay Live Key ID' })
  @IsOptional()
  @IsString()
  razorpayLiveKeyId?: string;

  @ApiPropertyOptional({ example: 'secret_...', description: 'Razorpay Live Key Secret' })
  @IsOptional()
  @IsString()
  razorpayLiveKeySecret?: string;

  @ApiPropertyOptional({ example: false, description: 'Enable or disable offline/bank transfer payments' })
  @IsOptional()
  offlinePaymentEnabled?: boolean;

  @ApiPropertyOptional({ example: 'whsec_...', description: 'Webhook secret' })
  @IsOptional()
  @IsString()
  webhookSecret?: string;
}
