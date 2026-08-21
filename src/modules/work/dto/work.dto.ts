import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { WorkType, WorkStatus, WorkPriority } from '@prisma/client';

export class CreateWorkDto {
  @ApiProperty({ example: 'Reels Shoot for Summer Launch' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ enum: WorkType, example: WorkType.REELS_SHOOT })
  @IsEnum(WorkType)
  workType: WorkType;

  @ApiPropertyOptional({ example: 'Shoot 2 reels on location at Bandra outlet' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: '2026-08-25T10:00:00.000Z' })
  @IsDateString()
  scheduledDate: string;

  @ApiPropertyOptional({ example: '10:00 AM' })
  @IsString()
  @IsOptional()
  scheduledTime?: string;

  @ApiPropertyOptional({ enum: WorkPriority, example: WorkPriority.MEDIUM })
  @IsEnum(WorkPriority)
  @IsOptional()
  priority?: WorkPriority;

  @ApiPropertyOptional({ example: 'team-uuid' })
  @IsString()
  @IsOptional()
  teamId?: string;

  @ApiPropertyOptional({ example: 'employee-uuid' })
  @IsString()
  @IsOptional()
  assignedToId?: string;

  @ApiPropertyOptional({ example: 'Plan Entitlement Service: Reels' })
  @IsString()
  @IsOptional()
  serviceName?: string;
}

export class UpdateWorkDto {
  @ApiPropertyOptional({ example: 'Updated Reels Shoot Title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ enum: WorkStatus, example: WorkStatus.COMPLETED })
  @IsEnum(WorkStatus)
  @IsOptional()
  status?: WorkStatus;

  @ApiPropertyOptional({ enum: WorkPriority, example: WorkPriority.HIGH })
  @IsEnum(WorkPriority)
  @IsOptional()
  priority?: WorkPriority;

  @ApiPropertyOptional({ example: 'https://storage.quikboom.com/works/reel-01.mp4' })
  @IsString()
  @IsOptional()
  outputUrl?: string;

  @ApiPropertyOptional({ example: 'Editing completed and verified' })
  @IsString()
  @IsOptional()
  notes?: string;
}
