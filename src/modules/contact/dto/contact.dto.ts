import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ContactType } from '@prisma/client';

export class CreateContactDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({ example: 'john.doe@example.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+1-555-0188' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'VP of Engineering' })
  @IsString()
  @IsOptional()
  designation?: string;

  @ApiPropertyOptional({ enum: ContactType, example: ContactType.CUSTOMER })
  @IsEnum(ContactType)
  @IsOptional()
  type?: ContactType;

  @ApiPropertyOptional({ example: 'company-uuid-here' })
  @IsString()
  @IsOptional()
  companyId?: string;

  @ApiPropertyOptional({ example: ['VIP', 'DECISION_MAKER'] })
  @IsArray()
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ example: 'Key contact for Q3 enterprise renewal.' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateContactDto extends CreateContactDto {}
