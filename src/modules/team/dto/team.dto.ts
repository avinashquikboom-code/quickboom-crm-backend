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

  @ApiPropertyOptional({ example: 'employee-leader-uuid' })
  @IsString()
  @IsOptional()
  leaderId?: string;

  @ApiPropertyOptional({ example: ['employee-uuid-1', 'employee-uuid-2'] })
  @IsArray()
  @IsOptional()
  memberIds?: string[];
}

export class AddTeamMemberDto {
  @ApiProperty({ example: 'employee-uuid' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiPropertyOptional({ example: 'PHOTOGRAPHER' })
  @IsString()
  @IsOptional()
  role?: string;
}
