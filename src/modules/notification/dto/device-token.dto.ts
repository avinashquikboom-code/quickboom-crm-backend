import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsIn, IsNumber, IsObject, IsBoolean, IsArray, IsDateString } from 'class-validator';

export class RegisterDeviceTokenDto {
  @ApiProperty({ description: 'Firebase Cloud Messaging Device Registration Token', example: 'fcm_token_xyz...' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiPropertyOptional({ description: 'Client Platform', enum: ['ANDROID', 'IOS', 'WEB', 'android', 'ios', 'web'], default: 'ANDROID' })
  @IsOptional()
  @IsString()
  @IsIn(['ANDROID', 'IOS', 'WEB', 'android', 'ios', 'web'])
  platform?: string;

  @ApiPropertyOptional({ description: 'Device Type', example: 'ADMIN_PANEL' })
  @IsOptional()
  @IsString()
  deviceType?: string;
}

export class UnregisterDeviceTokenDto {
  @ApiProperty({ description: 'Firebase Cloud Messaging Device Registration Token to deactivate' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class SendNotificationDto {
  @ApiPropertyOptional({ description: 'Target User ID (optional if customerId is provided)', example: 1 })
  @IsOptional()
  @IsNumber()
  userId?: number;

  @ApiPropertyOptional({ description: 'Target Customer ID (optional)', example: 1 })
  @IsOptional()
  @IsNumber()
  customerId?: number;

  @ApiProperty({ description: 'Notification Title', example: 'Order Confirmed' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Notification Body / Message', example: 'Your order #123 has been confirmed.' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ description: 'Notification category / type', example: 'ORDER_CONFIRMED', default: 'GENERAL' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    description: 'Custom Key-Value Data Payload (e.g. { type: "ORDER", orderId: "123" })',
    example: { type: 'ORDER', orderId: '123' },
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;
}

export class TestTokenDto {
  @ApiProperty({ description: 'Firebase Cloud Messaging Device Registration Token to test' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiPropertyOptional({ description: 'Test notification title', default: 'Test Push Notification' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Test notification body', default: 'This is a test notification outside the app.' })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({ description: 'Optional data payload' })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;
}

export class AdminOfferNotificationDto {
  @ApiProperty({ description: 'Offer title', example: 'Special Festive Discount!' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Offer message/details', example: 'Get 20% off on all annual plans with code FESTIVE20!' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ description: 'Target audience: CUSTOMERS or EMPLOYEES', enum: ['CUSTOMERS', 'EMPLOYEES'], default: 'CUSTOMERS' })
  @IsOptional()
  @IsString()
  @IsIn(['CUSTOMERS', 'EMPLOYEES', 'customers', 'employees'])
  targetType?: string;

  @ApiPropertyOptional({ description: 'Audience selection: ALL or SPECIFIC', enum: ['ALL', 'SPECIFIC'], default: 'ALL' })
  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'SPECIFIC', 'all', 'specific'])
  audience?: string;

  @ApiPropertyOptional({ description: 'Array of specific Customer IDs or Employee IDs when audience is SPECIFIC', example: [1, 2, 3] })
  @IsOptional()
  @IsArray()
  targetIds?: number[];

  @ApiPropertyOptional({ description: 'Target customer ID (optional: if omitted, broadcast to all active customers)', example: 1 })
  @IsOptional()
  @IsNumber()
  customerId?: number;

  @ApiPropertyOptional({ description: 'Optional promo / offer code', example: 'FESTIVE20' })
  @IsOptional()
  @IsString()
  offerCode?: string;

  @ApiPropertyOptional({ description: 'Optional banner image URL', example: 'https://example.com/banner.png' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Whether to display customizable CTA button on notification', default: false })
  @IsOptional()
  @IsBoolean()
  showCta?: boolean;

  @ApiPropertyOptional({ description: 'Custom CTA button label (e.g. Claim Offer, View Plan)', example: 'Claim Offer' })
  @IsOptional()
  @IsString()
  ctaText?: string;

  @ApiPropertyOptional({ description: 'CTA action type', enum: ['DEEP_LINK', 'WEB_URL'], default: 'DEEP_LINK' })
  @IsOptional()
  @IsString()
  @IsIn(['DEEP_LINK', 'WEB_URL', 'deep_link', 'web_url'])
  ctaActionType?: string;

  @ApiPropertyOptional({ description: 'Destination deep link or web URL for CTA action', example: '/customer/plans' })
  @IsOptional()
  @IsString()
  ctaActionValue?: string;

  @ApiPropertyOptional({ description: 'Optional deep link route in mobile app', example: '/subscription-plans' })
  @IsOptional()
  @IsString()
  deepLink?: string;

  @ApiPropertyOptional({ description: 'Optional future schedule timestamp (ISO 8601 string). If omitted, sends immediately.', example: '2026-10-01T10:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class TestCustomerNotificationDto {
  @ApiProperty({ description: 'Customer ID whose active devices should receive the test push', example: 1 })
  @IsNotEmpty()
  customerId: number | string;
}

