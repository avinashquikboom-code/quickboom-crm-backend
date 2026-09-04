import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SetRoleLeadLimitDto {
  @ApiProperty({ description: 'Role or designation name (e.g. Sales Executive, Telecaller)' })
  @IsString()
  @IsNotEmpty()
  roleName: string;

  @ApiProperty({ description: 'Daily lead generation limit', example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyLimit: number;

  @ApiProperty({ description: 'Monthly lead generation limit', example: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyLimit: number;

  @ApiPropertyOptional({ description: 'Whether role lead limit is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetEmployeeLeadLimitDto {
  @ApiPropertyOptional({ description: 'Custom daily lead generation limit. Null to use role default', nullable: true, example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyLimit?: number | null;

  @ApiPropertyOptional({ description: 'Custom monthly lead generation limit. Null to use role default', nullable: true, example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyLimit?: number | null;
}
