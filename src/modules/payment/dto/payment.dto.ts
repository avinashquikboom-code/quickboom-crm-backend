import { IsNotEmpty, IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SubscriptionBillingCycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export class CreateRazorpayOrderDto {
  @ApiProperty({ example: 1, description: 'Plan ID from database' })
  @IsNotEmpty()
  planId: number | string;

  @ApiPropertyOptional({ enum: SubscriptionBillingCycle, default: SubscriptionBillingCycle.MONTHLY })
  @IsOptional()
  @IsEnum(SubscriptionBillingCycle)
  billingCycle?: SubscriptionBillingCycle;

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
}
