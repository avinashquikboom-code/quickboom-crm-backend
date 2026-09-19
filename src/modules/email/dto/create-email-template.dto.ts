import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateEmailTemplateDto {
  @ApiProperty({ description: 'Human-readable name of the template', example: 'Email OTP' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name: string;

  @ApiProperty({ description: 'Unique identifier key for system resolution', example: 'EMAIL_OTP' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '_') : value)
  key: string;

  @ApiProperty({ description: 'Email subject template supporting {{variables}}', example: 'Your OTP for {{companyName}}' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  subject: string;

  @ApiProperty({ description: 'Email body template supporting {{variables}} and HTML/Text', example: 'Hello {{userName}},\n\nYour verification OTP is {{otp}}.' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ description: 'Brief description of when this template is used', example: 'Verification OTP sent to user email' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  description?: string;

  @ApiPropertyOptional({ description: 'Category of template (AUTH, HR, CRM, GENERAL)', example: 'AUTH', default: 'GENERAL' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  category?: string;

  @ApiPropertyOptional({ description: 'List of supported variable placeholders without curly braces', example: ['companyName', 'userName', 'otp'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedVariables?: string[];

  @ApiPropertyOptional({ description: 'Whether this template is currently active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
