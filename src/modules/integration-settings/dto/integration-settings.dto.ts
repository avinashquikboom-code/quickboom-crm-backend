import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateIntegrationDto {
  @ApiPropertyOptional({ description: 'Enable or disable the integration', example: true })
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Environment mode (LIVE or TEST)', example: 'LIVE' })
  @IsString()
  @IsOptional()
  environment?: string;

  @ApiPropertyOptional({
    description: 'Key-value map of credentials (sensitive values will be encrypted automatically)',
    example: { keyId: 'rzp_live_xxx', keySecret: 'rzp_sec_live_xxx', webhookSecret: 'whsec_xxx' },
  })
  @IsObject()
  @IsOptional()
  credentials?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Provider-specific non-sensitive configuration settings',
    example: { enableEcoRouting: true, defaultCity: 'Mumbai, Maharashtra' },
  })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
}

export class TestIntegrationDto {
  @ApiPropertyOptional({
    description: 'Optional live credentials to test before saving (uses saved DB credentials if omitted)',
  })
  @IsObject()
  @IsOptional()
  credentials?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Provider-specific non-sensitive configuration settings to test with',
    example: { host: 'smtp.gmail.com', port: 587 },
  })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Environment mode to test with', example: 'LIVE' })
  @IsString()
  @IsOptional()
  environment?: string;

  // Optional flat properties for direct testing payload compatibility
  @ApiPropertyOptional({ description: 'SMTP Host', example: 'smtp.gmail.com' })
  @IsString()
  @IsOptional()
  host?: string;

  @ApiPropertyOptional({ description: 'SMTP Port', example: 587 })
  @IsOptional()
  port?: number | string;

  @ApiPropertyOptional({ description: 'SMTP Security/Encryption (TLS, SSL, NONE)', example: 'TLS' })
  @IsString()
  @IsOptional()
  security?: string;

  @ApiPropertyOptional({ description: 'SMTP Encryption alias', example: 'TLS' })
  @IsString()
  @IsOptional()
  encryption?: string;

  @ApiPropertyOptional({ description: 'SMTP Username' })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ description: 'SMTP Password' })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({ description: 'SMTP From Email', example: 'crm@yourcompany.com' })
  @IsString()
  @IsOptional()
  fromEmail?: string;

  @ApiPropertyOptional({ description: 'SMTP From Name', example: 'QuickBoom CRM' })
  @IsString()
  @IsOptional()
  fromName?: string;

  @ApiPropertyOptional({ description: 'SMTP Host alias' })
  @IsString()
  @IsOptional()
  smtpHost?: string;

  @ApiPropertyOptional({ description: 'SMTP Port alias' })
  @IsOptional()
  smtpPort?: number | string;

  @ApiPropertyOptional({ description: 'SMTP Username alias' })
  @IsString()
  @IsOptional()
  smtpUsername?: string;

  @ApiPropertyOptional({ description: 'SMTP Password alias' })
  @IsString()
  @IsOptional()
  smtpPassword?: string;

  @ApiPropertyOptional({ description: 'SMTP Security alias' })
  @IsString()
  @IsOptional()
  smtpSecurity?: string;

  @ApiPropertyOptional({ description: 'SMTP From Email alias' })
  @IsString()
  @IsOptional()
  smtpFromEmail?: string;

  @ApiPropertyOptional({ description: 'SMTP From Name alias' })
  @IsString()
  @IsOptional()
  smtpFromName?: string;

  @ApiPropertyOptional({ description: 'Optional test recipient email address' })
  @IsString()
  @IsOptional()
  recipientEmail?: string;

  @ApiPropertyOptional({ description: 'Optional test recipient email alias' })
  @IsString()
  @IsOptional()
  to?: string;
}
