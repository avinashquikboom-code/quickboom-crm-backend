import { IsString, IsNotEmpty, IsOptional, IsArray, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

export class ModuleResetDto {
  @IsString()
  @IsNotEmpty()
  module: string;

  @IsString()
  @IsNotEmpty()
  confirmation: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class MultipleModulesResetDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  modules: string[];

  @IsString()
  @IsNotEmpty()
  confirmation: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class ResetAllDto {
  @IsString()
  @IsNotEmpty()
  scope: string; // 'transactional'

  @IsString()
  @IsNotEmpty()
  confirmation: string; // 'RESET ALL DATA'

  @IsString()
  @IsOptional()
  reason?: string;
}

export class EmployeeModuleResetDto {
  @IsString()
  @IsNotEmpty()
  module: string;

  @IsString()
  @IsNotEmpty()
  confirmation: string; // e.g. 'RESET EMPLOYEE ATTENDANCE'

  @IsString()
  @IsOptional()
  reason?: string;
}

export class EmployeeResetAllDto {
  @IsString()
  @IsNotEmpty()
  confirmation: string; // 'RESET ALL DATA FOR EMPLOYEE'

  @IsString()
  @IsOptional()
  reason?: string;
}

export class ResetPreviewDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') {
      return value.split(',').map((v) => v.trim()).filter(Boolean);
    }
    return value;
  })
  @IsArray()
  @IsString({ each: true })
  modules?: string[];

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsIn(['selected', 'application', 'global', 'tenant'])
  scope?: 'selected' | 'application' | 'global' | 'tenant';
}

export class ExecuteResetDto extends ResetPreviewDto {
  @IsString()
  @IsNotEmpty()
  previewToken: string;

  @IsString()
  @IsNotEmpty()
  confirmation: string;

  @IsOptional()
  @IsString()
  acknowledgement?: string;

  @IsOptional()
  @IsString()
  globalConfirmation?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateBackupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];

  @IsOptional()
  @IsIn(['tenant', 'global'])
  scope?: 'tenant' | 'global';
}

export class RestoreBackupDto {
  @IsString()
  @IsNotEmpty()
  confirmation: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}

export class CleanupPreviewDto {
  @IsString()
  @IsNotEmpty()
  operation: string;
}

export class ExecuteCleanupDto extends CleanupPreviewDto {
  @IsString()
  @IsNotEmpty()
  confirmation: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}

export class ImportLeadsDto {
  @IsString()
  @IsNotEmpty()
  csv: string;

  @IsOptional()
  @IsString()
  confirmation?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class BulkDeleteBinItemDto {
  @IsNotEmpty()
  id: number | string;

  @IsString()
  @IsNotEmpty()
  type: 'CUSTOMER' | 'EMPLOYEE';
}

export class BulkDeleteBinDto {
  @IsOptional()
  @IsArray()
  items?: BulkDeleteBinItemDto[];

  @IsOptional()
  @IsArray()
  customerIds?: (number | string)[];

  @IsOptional()
  @IsArray()
  employeeIds?: (number | string)[];
}

