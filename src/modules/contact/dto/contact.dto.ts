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

  @ApiPropertyOptional({ example: '+91 98200 11111' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: '+91 98200 22222' })
  @IsString()
  @IsOptional()
  mobile?: string;

  @ApiPropertyOptional({ example: '+91 22 2345 6789' })
  @IsString()
  @IsOptional()
  alternateMobile?: string;

  @ApiPropertyOptional({ example: 'https://johndoe.com' })
  @IsString()
  @IsOptional()
  website?: string;

  @ApiPropertyOptional({ example: 'VP of Engineering' })
  @IsString()
  @IsOptional()
  designation?: string;

  @ApiPropertyOptional({ enum: ContactType, example: ContactType.CUSTOMER })
  @IsEnum(ContactType)
  @IsOptional()
  type?: ContactType;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  companyId?: string;

  @ApiPropertyOptional({ example: 'DIRECT' })
  @IsString()
  @IsOptional()
  source?: string;

  @ApiPropertyOptional({ example: 'ACTIVE' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  assignedToId?: string;

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

export class CheckDuplicateContactDto {
  @ApiPropertyOptional({ example: 'john.doe@example.com' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+91 98200 11111' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  companyId?: string;
}
