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

