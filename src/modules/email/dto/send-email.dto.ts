import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendEmailDto {
  @ApiProperty({ description: 'Recipient email address', example: 'client@example.com' })
  @IsEmail({}, { message: 'Please provide a valid recipient email address' })
  @IsNotEmpty({ message: 'Recipient email is required' })
  to: string;

  @ApiProperty({ description: 'Email subject line', example: 'Follow-up regarding proposal' })
  @IsString()
  @IsNotEmpty({ message: 'Email subject is required' })
  subject: string;

  @ApiPropertyOptional({ description: 'HTML content of email body' })
  @IsString()
  @IsOptional()
  html?: string;

  @ApiPropertyOptional({ description: 'Plain text content of email body' })
  @IsString()
  @IsOptional()
  text?: string;

  @ApiPropertyOptional({ description: 'Generic body content (plain text or html)' })
  @IsString()
  @IsOptional()
  body?: string;

  @ApiPropertyOptional({ description: 'Custom sender email override (uses SMTP From Email if omitted)' })
  @IsEmail({}, { message: 'Invalid sender email format' })
  @IsOptional()
  fromEmail?: string;

  @ApiPropertyOptional({ description: 'Custom sender name override (uses SMTP From Name if omitted)' })
  @IsString()
  @IsOptional()
  fromName?: string;

  @ApiPropertyOptional({ description: 'Associated record type (e.g. lead, contact, customer)' })
  @IsString()
  @IsOptional()
  recordType?: string;

  @ApiPropertyOptional({ description: 'Associated record ID' })
  @IsOptional()
  recordId?: string | number;

  @ApiPropertyOptional({ description: 'Email template ID if selected from active templates' })
  @IsOptional()
  templateId?: number;

  @ApiPropertyOptional({ description: 'CC email recipients' })
  @IsOptional()
  cc?: string | string[];

  @ApiPropertyOptional({ description: 'BCC email recipients' })
  @IsOptional()
  bcc?: string | string[];

  @ApiPropertyOptional({ description: 'Event type identifier (e.g. LEAD_STAGE_CHANGED)' })
  @IsString()
  @IsOptional()
  eventType?: string;

  @ApiPropertyOptional({ description: 'Optional email file attachments (Buffer or path)' })
  @IsOptional()
  attachments?: any[];
}

