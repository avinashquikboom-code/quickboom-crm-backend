import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateGeneralSettingsDto {
  @ApiPropertyOptional({ description: 'Application display name', example: 'QB Suite' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  appName?: string;

  @ApiPropertyOptional({ description: 'Application logo URL', example: 'https://example.com/logo.png' })
  @IsString()
  @IsOptional()
  appLogoUrl?: string;

  @ApiPropertyOptional({ description: 'Default system language', example: 'en' })
  @IsString()
  @IsOptional()
  defaultLanguage?: string;

  @ApiPropertyOptional({ description: 'Enabled system languages', example: ['en', 'mr'] })
  @IsArray()
  @IsOptional()
  availableLanguages?: string[];

  @ApiPropertyOptional({ description: 'Default locale identifier', example: 'en-IN' })
  @IsString()
  @IsOptional()
  defaultLocale?: string;

  @ApiPropertyOptional({ description: 'Default system timezone', example: 'Asia/Kolkata' })
  @IsString()
  @IsOptional()
  defaultTimezone?: string;

  @ApiPropertyOptional({ description: 'Date format string', example: 'DD-MM-YYYY' })
  @IsString()
  @IsOptional()
  dateFormat?: string;

  @ApiPropertyOptional({ description: 'Time format (12h or 24h)', example: '12h' })
  @IsString()
  @IsOptional()
  timeFormat?: string;

  @ApiPropertyOptional({ description: 'First day of the week', example: 'Monday' })
  @IsString()
  @IsOptional()
  firstDayOfWeek?: string;

  @ApiPropertyOptional({ description: 'Default currency code', example: 'INR' })
  @IsString()
  @IsOptional()
  defaultCurrency?: string;

  @ApiPropertyOptional({ description: 'Currency symbol', example: '₹' })
  @IsString()
  @IsOptional()
  currencySymbol?: string;

  @ApiPropertyOptional({ description: 'Currency alphabetic code', example: 'INR' })
  @IsString()
  @IsOptional()
  currencyCode?: string;

  @ApiPropertyOptional({ description: 'Currency decimal precision', example: 2 })
  @IsInt()
  @Min(0)
  @IsOptional()
  decimalPrecision?: number;

  @ApiPropertyOptional({ description: 'Number formatting locale', example: 'en-IN' })
  @IsString()
  @IsOptional()
  numberFormatting?: string;

  @ApiPropertyOptional({ description: 'Currency display format (SYMBOL_FIRST or CODE_FIRST)', example: 'SYMBOL_FIRST' })
  @IsString()
  @IsOptional()
  currencyDisplayFormat?: string;

  @ApiPropertyOptional({ description: 'Favicon URL', example: 'https://example.com/favicon.ico' })
  @IsString()
  @IsOptional()
  faviconUrl?: string;

  @ApiPropertyOptional({ description: 'Login page subtitle/branding text' })
  @IsString()
  @IsOptional()
  loginPageBranding?: string;

  @ApiPropertyOptional({ description: 'Primary brand theme color', example: '#163A2E' })
  @IsString()
  @IsOptional()
  primaryColor?: string;

  @ApiPropertyOptional({ description: 'Secondary brand theme color', example: '#204C3D' })
  @IsString()
  @IsOptional()
  secondaryColor?: string;

  @ApiPropertyOptional({ description: 'Pale accent theme color', example: '#E8F1EC' })
  @IsString()
  @IsOptional()
  paleColor?: string;
}

