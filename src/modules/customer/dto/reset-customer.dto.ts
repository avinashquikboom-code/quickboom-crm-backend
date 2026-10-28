import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResetCustomerDataDto {
  @ApiProperty({
    description: 'Exact customer name or company name typed to confirm deletion',
    example: 'Care Fitness Gym',
  })
  @IsString()
  @IsNotEmpty()
  confirmation: string;

  @ApiPropertyOptional({
    description: 'Optional administrative reason for the data reset',
    example: 'Client requested complete CRM & billing data wipe after testing period',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Whether to preserve customer subscription/plan assignment (defaults to true)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  preserveSubscriptions?: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to preserve customer invoice records (defaults to false - invoices will be wiped)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  preserveInvoices?: boolean = false;
}
