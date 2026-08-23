import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsArray,
  IsEmail,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ExtractPlacesDto {
  @IsString()
  @IsNotEmpty({ message: 'Keyword is required (e.g. Gyms, Clinics, Restaurants)' })
  keyword: string;

  @IsString()
  @IsNotEmpty({ message: 'Location is required (e.g. Vadodara, Mumbai, Pune)' })
  location: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(60)
  @Type(() => Number)
  maxResults?: number;
}

export class ImportToLeadsDto {
  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  placeIds?: string[];

  @IsOptional()
  @IsString()
  leadStatus?: string;

  @IsOptional()
  @IsString()
  priority?: string;
}

export class CreateDataCaptureDto {
  @IsString()
  @IsNotEmpty({ message: 'Business name is required' })
  businessName: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  googlePlaceId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  rating?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  reviewCount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  @IsOptional()
  @IsString()
  googleMapsUrl?: string;

  @IsOptional()
  @IsString()
  businessStatus?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  rawData?: any;
}

export class UpdateDataCaptureDto {
  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  googlePlaceId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  rating?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  reviewCount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  @IsOptional()
  @IsString()
  googleMapsUrl?: string;

  @IsOptional()
  @IsString()
  businessStatus?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isImported?: boolean;

  @IsOptional()
  rawData?: any;
}

export class DataCaptureQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class RejectDataCaptureDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BulkActionDto {
  @IsArray()
  @IsNumber({}, { each: true })
  ids: number[];

  @IsString()
  @IsIn(['validate', 'reject', 'mark_duplicate', 'delete', 'import_leads'])
  action: 'validate' | 'reject' | 'mark_duplicate' | 'delete' | 'import_leads';

  @IsOptional()
  @IsString()
  reason?: string;
}
