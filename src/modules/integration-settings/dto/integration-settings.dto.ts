import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateIntegrationDto {
  @ApiProperty({ description: 'Enable or disable the integration', example: true })
  @IsBoolean()
  @IsNotEmpty()
  isEnabled: boolean;

  @ApiPropertyOptional({ description: 'Environment mode (LIVE or TEST)', example: 'LIVE' })
  @IsString()
  @IsOptional()
  environment?: string;

  @ApiProperty({
    description: 'Key-value map of credentials (sensitive values will be encrypted automatically)',
    example: { keyId: 'rzp_live_xxx', keySecret: 'rzp_sec_live_xxx', webhookSecret: 'whsec_xxx' },
  })
  @IsObject()
  @IsNotEmpty()
  credentials: Record<string, any>;

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
}
