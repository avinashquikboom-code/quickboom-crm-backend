import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max, IsArray } from 'class-validator';

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
  maxResults?: number;
}

export class ImportToLeadsDto {
  @IsString()
  @IsNotEmpty({ message: 'Job ID is required' })
  jobId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  placeIds?: string[];

  @IsOptional()
  @IsString()
  leadStatus?: string;
}
