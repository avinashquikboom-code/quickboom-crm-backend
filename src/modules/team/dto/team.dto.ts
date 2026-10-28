import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({ example: 'SSM Creative Squad' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Handles reels shooting, graphic design, and video editing' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 12, description: 'Employee ID of the designated team leader' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  leaderId?: number;

  @ApiPropertyOptional({ example: [12, 14, 15], description: 'List of Employee IDs assigned as team members' })
  @IsArray()
  @IsOptional()
  @IsInt({ each: true })
  @Type(() => Number)
  memberIds?: number[];

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateTeamDto {
  @ApiPropertyOptional({ example: 'SSM Creative Squad' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Handles reels shooting, graphic design, and video editing' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 12, description: 'Employee ID of the designated team leader' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  leaderId?: number | null;

  @ApiPropertyOptional({ example: [12, 14, 15], description: 'List of Employee IDs assigned as team members' })
  @IsArray()
  @IsOptional()
  @IsInt({ each: true })
  @Type(() => Number)
  memberIds?: number[];

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class AddTeamMemberDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  @IsNotEmpty()
  @Type(() => Number)
  employeeId: number;

  @ApiPropertyOptional({ example: 'MEMBER', default: 'MEMBER' })
  @IsString()
  @IsOptional()
  role?: string;
}

export class TeamQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ALL'], default: 'ALL' })
  @IsString()
  @IsOptional()
  status?: 'ACTIVE' | 'INACTIVE' | 'ALL' = 'ALL';

  @ApiPropertyOptional({ description: 'Customer ID override (SUPER_ADMIN only)' })
  @IsOptional()
  customerId?: string | number;
}
