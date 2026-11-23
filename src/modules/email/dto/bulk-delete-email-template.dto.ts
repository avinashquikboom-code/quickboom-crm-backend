import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, ArrayNotEmpty, IsInt, IsOptional, IsString } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class BulkDeleteEmailTemplatesDto {
  @ApiProperty({ description: 'Array of Email template IDs to permanently delete', type: [Number], example: [1, 2, 3] })
  @IsArray()
  @ArrayNotEmpty({ message: 'ids array cannot be empty' })
  @IsInt({ each: true, message: 'Each id must be an integer' })
  @Type(() => Number)
  ids: number[];

  @ApiPropertyOptional({ description: 'Reason recorded in the audit log', example: 'Bulk cleanup of obsolete templates' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().slice(0, 500) : value))
  reason?: string;
}

export class DeleteEmailTemplateDto {
  @ApiPropertyOptional({ description: 'Reason recorded in the audit log' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().slice(0, 500) : value))
  reason?: string;
}
