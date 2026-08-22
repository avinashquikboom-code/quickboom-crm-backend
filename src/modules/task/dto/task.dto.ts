import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { TaskPriority, TaskStatus } from '@prisma/client';

export class CreateTaskDto {
  @ApiProperty({ example: 'Complete Client Onboarding Audit' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Verify on-site attendance logs, biometric records and employee rosters.' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ enum: TaskPriority, example: TaskPriority.HIGH })
  @IsEnum(TaskPriority)
  @IsNotEmpty()
  priority: TaskPriority;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  employeeId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  designationId?: string;

  @ApiProperty({ example: '2026-08-25' })
  @IsString()
  @IsNotEmpty()
  dueDate: string;

  @ApiProperty({ example: '06:30 PM' })
  @IsString()
  @IsNotEmpty()
  dueTime: string;

  @ApiPropertyOptional({ example: '2026-08-23' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '09:00 AM' })
  @IsString()
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({ example: 'HR_OPERATIONS' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ example: 'Please ensure high-resolution photos of signed forms are attached.' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  assignedToId?: string;
}

export class UpdateTaskDto {
  @ApiPropertyOptional({ example: 'Updated Task Title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated task description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: TaskPriority, example: TaskPriority.HIGH })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @ApiPropertyOptional({ enum: TaskStatus, example: TaskStatus.IN_PROGRESS })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  employeeId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsString()
  @IsOptional()
  designationId?: string;

  @ApiPropertyOptional({ example: '2026-08-25' })
  @IsString()
  @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional({ example: '06:30 PM' })
  @IsString()
  @IsOptional()
  dueTime?: string;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class ReallocateTaskDto {
  @ApiProperty({ example: '2' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiPropertyOptional({ example: 'Primary employee on emergency medical leave' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class SubmitTaskProofDto {
  @ApiProperty({ example: 'https://res.cloudinary.com/qbapp/image/upload/v123/proof.jpg' })
  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @ApiPropertyOptional({ example: 'audit_photo_1.jpg' })
  @IsString()
  @IsOptional()
  fileName?: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsString()
  @IsOptional()
  fileType?: string;

  @ApiPropertyOptional({ example: 1048576 })
  @IsNumber()
  @IsOptional()
  fileSize?: number;

  @ApiPropertyOptional({ example: 'Completed on-site verification and took photo of signed agreement.' })
  @IsString()
  @IsOptional()
  comment?: string;
}

export class ReviewTaskDto {
  @ApiPropertyOptional({ example: 'Photo proof is clear and verified with client.' })
  @IsString()
  @IsOptional()
  comment?: string;

  @ApiPropertyOptional({ example: 'Photo proof is blurry or incomplete.' })
  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
