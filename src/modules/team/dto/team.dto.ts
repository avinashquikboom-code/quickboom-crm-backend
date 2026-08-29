import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({ example: 'SSM Production Team A' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Dedicated team for video shooting, reels editing and design' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  leaderId?: number | string;

  @ApiPropertyOptional({ example: [1, 2] })
  @IsArray()
  @IsOptional()
  memberIds?: (number | string)[];
}

export class AddTeamMemberDto {
  @ApiProperty({ example: 1 })
  @IsNotEmpty()
  employeeId: number | string;

  @ApiPropertyOptional({ example: 'PHOTOGRAPHER' })
  @IsString()
  @IsOptional()
  role?: string;
}
