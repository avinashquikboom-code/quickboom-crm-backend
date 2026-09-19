import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsIn, IsNumber, IsObject } from 'class-validator';

export class RegisterDeviceTokenDto {
  @ApiProperty({ description: 'Firebase Cloud Messaging Device Registration Token', example: 'fcm_token_xyz...' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiPropertyOptional({ description: 'Client Platform', enum: ['ANDROID', 'IOS', 'WEB'], default: 'ANDROID' })
  @IsOptional()
  @IsString()
  @IsIn(['ANDROID', 'IOS', 'WEB'])
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

  @ApiPropertyOptional({ description: 'Optional deep link route in mobile app', example: '/subscription-plans' })
  @IsOptional()
  @IsString()
  deepLink?: string;
}

export class TestCustomerNotificationDto {
  @ApiProperty({ description: 'Customer ID whose active devices should receive the test push', example: 1 })
  @IsNotEmpty()
  customerId: number | string;
}

