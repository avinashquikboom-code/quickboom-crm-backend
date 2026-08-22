import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class PunchAttendanceDto {
  @ApiProperty({ example: 19.0760, description: 'GPS Latitude of employee' })
  @IsNumber()
  @IsNotEmpty()
  latitude: number;

  @ApiProperty({ example: 72.8777, description: 'GPS Longitude of employee' })
  @IsNumber()
  @IsNotEmpty()
  longitude: number;

  @ApiPropertyOptional({ example: 'Mobile Check-in from Office Gate' })
  @IsString()
  @IsOptional()
  notes?: string;
}
