import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

export class PunchAttendanceDto {
  @ApiProperty({ example: 19.0760, description: 'GPS Latitude of employee (-90 to 90)' })
  @IsNumber()
  @IsNotEmpty()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: 72.8777, description: 'GPS Longitude of employee (-180 to 180)' })
  @IsNumber()
  @IsNotEmpty()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ example: 12.5, description: 'GPS Accuracy radius in meters' })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  accuracy?: number;

  @ApiPropertyOptional({ example: 'Mobile Check-in from Office Gate' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 'Main Entrance, Ground Floor' })
  @IsString()
  @IsOptional()
  address?: string;
}

export class QueryAttendanceHistoryDto {
  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  page?: number | string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  limit?: number | string;

  @ApiPropertyOptional({ example: 'ALL' })
  @IsOptional()
  @IsString()
  branch?: string;
}
