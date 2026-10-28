import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export type ReportModuleType = 'ATTENDANCE' | 'PAYROLL' | 'LEAVES' | 'EMPLOYEES' | 'VISITS' | 'REVENUE';

export class QueryReportDto {
  @ApiPropertyOptional({
    description: 'Report module type',
    enum: ['ATTENDANCE', 'PAYROLL', 'LEAVES', 'EMPLOYEES', 'VISITS', 'REVENUE'],
    default: 'ATTENDANCE',
  })
  @IsOptional()
  @IsIn(['ATTENDANCE', 'PAYROLL', 'LEAVES', 'EMPLOYEES', 'VISITS', 'REVENUE'])
  type?: ReportModuleType;

  @ApiPropertyOptional({ description: 'Start date in YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'End date in YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Status filter' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Branch or office location filter' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ description: 'Department filter' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Search term for employee name or code' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Target Customer ID (for Super Admin only)' })
  @IsOptional()
  customerId?: string | number;
}

export class ExportReportDto {
  @ApiPropertyOptional({
    description: 'Report type to export',
    enum: ['ATTENDANCE', 'PAYROLL', 'LEAVES', 'EMPLOYEES', 'VISITS', 'REVENUE'],
    default: 'ATTENDANCE',
  })
  @IsOptional()
  @IsIn(['ATTENDANCE', 'PAYROLL', 'LEAVES', 'EMPLOYEES', 'VISITS', 'REVENUE'])
  reportType?: ReportModuleType;

  @ApiPropertyOptional({ description: 'Export file format', enum: ['CSV', 'PDF'], default: 'CSV' })
  @IsOptional()
  @IsIn(['CSV', 'PDF'])
  format?: 'CSV' | 'PDF';

  @ApiPropertyOptional({ description: 'Start date in YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'End date in YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Status filter' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Branch or office location filter' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ description: 'Department filter' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Search keyword' })
  @IsOptional()
  @IsString()
  search?: string;
}
