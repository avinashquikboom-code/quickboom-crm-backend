import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { CrmLeadStatus, RecordCreatedFrom } from '@prisma/client';

export class CreateLeadDto {
  @IsString() @IsNotEmpty() @MaxLength(500) companyName: string;
  @IsOptional() @IsString() @MaxLength(200) firstName?: string;
  @IsOptional() @IsString() @MaxLength(200) lastName?: string;
  @IsOptional() @IsString() @MaxLength(100) phone?: string;
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== undefined && value !== '')
  @IsEmail()
  email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() googlePlaceId?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsEnum(CrmLeadStatus) status?: CrmLeadStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) assignedToId?: number;
  @IsOptional() @IsEnum(RecordCreatedFrom) createdFrom?: RecordCreatedFrom;
}

export class LeadQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(CrmLeadStatus) status?: CrmLeadStatus;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsEnum(RecordCreatedFrom) createdFrom?: RecordCreatedFrom;
}

export class UpdateLeadStageDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @Type(() => Number) @IsInt() stageId?: number;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateLeadDto {
  @IsOptional() @IsString() @MaxLength(500) companyName?: string;
  @IsOptional() @IsString() @MaxLength(200) firstName?: string;
  @IsOptional() @IsString() @MaxLength(200) lastName?: string;
  @IsOptional() @IsString() @MaxLength(100) phone?: string;
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== undefined && value !== '')
  @IsEmail()
  email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @Type(() => Number) @IsInt() stageId?: number;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) assignedToId?: number;
}

export class BulkDeleteLeadsDto {
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[];
}

