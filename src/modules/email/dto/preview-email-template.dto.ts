import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsObject, IsEmail } from 'class-validator';

export class PreviewEmailTemplateDto {
  @ApiProperty({ description: 'Template subject or raw text' })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({ description: 'Template body or raw HTML' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ description: 'Key-value map of variables to interpolate', example: { userName: 'Alex Smith', otp: '482910', companyName: 'QuickBoom' } })
  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;
}

export class TestSendTemplateDto {
  @ApiProperty({ description: 'Destination email to send the test email to', example: 'admin@quickboom.com' })
  @IsEmail()
  @IsNotEmpty()
  to: string;

  @ApiPropertyOptional({ description: 'Template ID if testing an existing saved template' })
  @IsOptional()
  templateId?: number | string;

  @ApiPropertyOptional({ description: 'Template key if testing by key' })
  @IsOptional()
  @IsString()
  templateKey?: string;

  @ApiPropertyOptional({ description: 'Custom subject override' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ description: 'Custom body override' })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({ description: 'Sample variables for interpolation' })
  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;
}
