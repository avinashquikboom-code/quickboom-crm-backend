import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SendFirebaseTestNotificationDto {
  @ApiPropertyOptional({
    description: 'Target recipient type: CURRENT_ADMIN, ALL_ADMINS, CUSTOMER, EMPLOYEE, BROADCAST',
    example: 'CURRENT_ADMIN',
    default: 'CURRENT_ADMIN',
  })
  @IsString()
  @IsOptional()
  recipientType?: string;

  @ApiPropertyOptional({
    description: 'Target Customer ID or Employee ID when recipientType is CUSTOMER or EMPLOYEE',
    example: '1',
  })
  @IsOptional()
  recipientId?: string | number;

  @ApiPropertyOptional({
    description: 'Direct FCM Device Registration Token (optional)',
    example: 'fcm_token_xyz...',
  })
  @IsString()
  @IsOptional()
  deviceToken?: string;

  @ApiPropertyOptional({
    description: 'Push Notification Title',
    example: 'QuikBoom Test Notification',
    default: 'QuikBoom Test Notification',
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({
    description: 'Push Notification Body / Message',
    example: 'Firebase Cloud Messaging is working correctly.',
    default: 'Firebase Cloud Messaging is working correctly.',
  })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiPropertyOptional({
    description: 'Alias for message body',
    example: 'Firebase Cloud Messaging is working correctly.',
  })
  @IsString()
  @IsOptional()
  body?: string;
}
