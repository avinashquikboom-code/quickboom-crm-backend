import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { LeadPriority, LeadStatus } from '@prisma/client';

export class CreateLeadDto {
  @ApiProperty({ example: 'Enterprise Cloud Modernization' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Alice' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Smith' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({ example: 'alice@techcorp.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+1-555-0199' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'TechCorp Solutions' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: 'WEBSITE' })
  @IsString()
  @IsOptional()
  source?: string;

  @ApiPropertyOptional({ enum: LeadStatus, example: LeadStatus.NEW })
  @IsEnum(LeadStatus)
  @IsOptional()
  status?: LeadStatus;

  @ApiPropertyOptional({ enum: LeadPriority, example: LeadPriority.HIGH })
  @IsEnum(LeadPriority)
  @IsOptional()
  priority?: LeadPriority;

  @ApiPropertyOptional({ example: 45000.0 })
  @IsNumber()
  @IsOptional()
  value?: number;

  @ApiPropertyOptional({ example: 'uuid-user-id' })
  @IsString()
  @IsOptional()
  assignedToId?: string;
}

export class UpdateLeadDto extends CreateLeadDto {}

export class CreateLeadNoteDto {
  @ApiProperty({ example: 'Client requested demo schedule next Monday.' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
