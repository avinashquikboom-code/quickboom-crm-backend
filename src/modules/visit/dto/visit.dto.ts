import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { VisitStatus } from '@prisma/client';

export class CreateVisitDto {
  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  employeeId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  companyId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  contactId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  leadId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  dealId?: string;

  @ApiProperty({ example: 'Apex Tech Solutions HQ' })
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @ApiProperty({ example: 'On-site Enterprise Product Demonstration' })
  @IsString()
  @IsNotEmpty()
  purpose: string;

  @ApiPropertyOptional({ example: 'CLIENT_MEETING' })
  @IsString()
  @IsOptional()
  visitType?: string;

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

  @ApiPropertyOptional({ enum: VisitStatus, example: VisitStatus.SCHEDULED })
  @IsEnum(VisitStatus)
  @IsOptional()
  status?: VisitStatus;

  @ApiPropertyOptional({ example: 'Client requested technical overview' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 'Client was very interested in HRM attendance features.' })
  @IsString()
  @IsOptional()
  outcome?: string;

  @ApiPropertyOptional({ example: '2026-09-02T10:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  nextFollowUpDate?: string;

  @ApiPropertyOptional({ example: 'Rahul Sharma' })
  @IsString()
  @IsOptional()
  completedBy?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsNumber()
  @IsOptional()
  completedById?: number;

  @ApiPropertyOptional({ example: 'Bhavesh Gandhi' })
  @IsString()
  @IsOptional()
  scheduledBy?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsNumber()
  @IsOptional()
  scheduledById?: number;
}

export class UpdateVisitDto {
  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  employeeId?: string;

  @ApiPropertyOptional({ example: 'Apex Tech Solutions' })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiPropertyOptional({ example: 'Proposal Discussion' })
  @IsString()
  @IsOptional()
  purpose?: string;

  @ApiPropertyOptional({ example: '2026-08-26T10:30:00.000Z' })
  @IsDateString()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({ example: '11:00 AM' })
  @IsString()
  @IsOptional()
  time?: string;

  @ApiPropertyOptional({ example: 'BKC, Mumbai' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ enum: VisitStatus, example: VisitStatus.COMPLETED })
  @IsEnum(VisitStatus)
  @IsOptional()
  status?: VisitStatus;

  @ApiPropertyOptional({ example: 'Client approved the storyboard on-site' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 'Successful demo, proposal requested' })
  @IsString()
  @IsOptional()
  outcome?: string;

  @ApiPropertyOptional({ example: '2026-09-02T10:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  nextFollowUpDate?: string;

  @ApiPropertyOptional({ example: 'Rahul Sharma' })
  @IsString()
  @IsOptional()
  completedBy?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsNumber()
  @IsOptional()
  completedById?: number;

  @ApiPropertyOptional({ example: 'Bhavesh Gandhi' })
  @IsString()
  @IsOptional()
  scheduledBy?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsNumber()
  @IsOptional()
  scheduledById?: number;
}
