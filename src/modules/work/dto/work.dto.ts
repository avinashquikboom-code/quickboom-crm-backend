import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
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

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  teamId?: number | string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  assignedToId?: number | string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  editorId?: number | string;

  @ApiPropertyOptional({ example: 'Reels' })
  @IsString()
  @IsOptional()
  serviceName?: string;

  @ApiPropertyOptional({ example: 'Customer notes / requirements' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 1, description: 'Purchase / Subscription ID' })
  @IsOptional()
  subscriptionId?: number | string;

  @ApiPropertyOptional({ example: 'PUR-001', description: 'Purchase reference code' })
  @IsString()
  @IsOptional()
  purchaseId?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Target customer for employee-created calendar schedules',
  })
  @IsOptional()
  customerId?: number | string;
}

export class UpdateWorkDto {
  @ApiPropertyOptional({ example: 1, description: 'Purchase / Subscription ID' })
  @IsOptional()
  subscriptionId?: number | string;

  @ApiPropertyOptional({ example: 'PUR-001', description: 'Purchase reference code' })
  @IsString()
  @IsOptional()
  purchaseId?: string;

  @ApiPropertyOptional({ example: 'Updated Reels Shoot Title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: '2026-08-25T10:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  scheduledDate?: string;

  @ApiPropertyOptional({ example: '11:00 AM' })
  @IsString()
  @IsOptional()
  scheduledTime?: string;

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

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  assignedToId?: number | string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  editorId?: number | string;
}

export class SubmitWorkDto {
  @ApiProperty({ example: 'https://storage.quikboom.com/works/reel-01.mp4' })
  @IsString()
  @IsNotEmpty()
  outputUrl: string;

  @ApiPropertyOptional({ example: 'Color grading and audio synced as per client instructions.' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class ReviewWorkDto {
  @ApiProperty({ example: 'Please brighten the intro and change background music.' })
  @IsString()
  @IsNotEmpty()
  feedback: string;
}

export class AssignWorkDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  assignedToId?: number | string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  editorId?: number | string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  teamId?: number | string;
}

export class CalendarEventResponseDto {
  @ApiProperty({ example: '3316' })
  id: string;

  @ApiProperty({ example: '3316' })
  activityId: string;

  @ApiProperty({ example: '111' })
  customerId: string;

  @ApiProperty({ example: 'Fitness Track Gym' })
  customerName: string;

  @ApiPropertyOptional({ example: 'PUR-001' })
  purchaseId?: string;

  @ApiPropertyOptional({ example: 'Reels' })
  productName?: string;

  @ApiPropertyOptional({ example: 'Reels' })
  serviceName?: string;

  @ApiPropertyOptional({ example: 'Starter Plan' })
  planName?: string;

  @ApiProperty({ example: 'Reel #1: Shoot' })
  title: string;

  @ApiProperty({ example: '2026-10-15' })
  scheduledDate: string;

  @ApiPropertyOptional({ example: '10:00 AM' })
  scheduledTime?: string;

  @ApiProperty({ example: 'ASSIGNED' })
  status: string;

  @ApiPropertyOptional({ example: 'PRODUCTION TEAM_A' })
  team?: string;

  @ApiPropertyOptional({ example: 'Shoot on location' })
  notes?: string;

  @ApiPropertyOptional({ example: 'https://storage.quikboom.com/works/reel-01.mp4' })
  outputUrl?: string;

  @ApiProperty({ example: false })
  isLocked: boolean;
}

/** Customer Calendar output only; shared work/employee mappings retain assignments. */
export function toCustomerCalendarScheduleResponse<T>(schedule: T): Omit<
  T, 'assignedToId' | 'assignedEmployee' | 'assignedToName' | 'editorName'
> {
  const response = { ...schedule };
  delete (response as any).assignedToId;
  delete (response as any).assignedEmployee;
  delete (response as any).assignedToName;
  delete (response as any).editorName;
  return response;
}

