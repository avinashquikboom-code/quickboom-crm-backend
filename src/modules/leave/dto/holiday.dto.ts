import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateHolidayDto {
  @ApiProperty({ example: 'Independence Day' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '2026-08-15' })
  @IsNotEmpty()
  date: string | Date;

  @ApiPropertyOptional({ example: 'National Public Holiday' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 1, description: 'Specific Office ID or null for All Offices' })
  @IsOptional()
  officeId?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateHolidayDto {
  @ApiPropertyOptional({ example: 'Independence Day' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: '2026-08-15' })
  @IsOptional()
  date?: string | Date;

  @ApiPropertyOptional({ example: 'National Public Holiday' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  officeId?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
