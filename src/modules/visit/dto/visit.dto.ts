import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { VisitStatus } from '@prisma/client';

export class CreateVisitDto {
  @ApiProperty({ example: 'employee-uuid' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ example: 'Apex Tech Solutions HQ' })
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @ApiProperty({ example: 'On-site Reels Production & Content Planning' })
  @IsString()
  @IsNotEmpty()
  purpose: string;

  @ApiProperty({ example: '2026-08-26T10:30:00.000Z' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ example: '10:30 AM' })
  @IsString()
  @IsOptional()
  time?: string;

  @ApiProperty({ example: 'BKC Commercial Tower, Floor 5, Mumbai' })
  @IsString()
  @IsNotEmpty()
  location: string;

  @ApiPropertyOptional({ example: 19.0760 })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({ example: 72.8777 })
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @ApiPropertyOptional({ example: 'Bring gimbal and primary lens setup' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateVisitDto {
  @ApiPropertyOptional({ enum: VisitStatus, example: VisitStatus.COMPLETED })
  @IsEnum(VisitStatus)
  @IsOptional()
  status?: VisitStatus;

  @ApiPropertyOptional({ example: 'Client approved the storyboard on-site' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 90 })
  @IsNumber()
  @IsOptional()
  duration?: number;
}
