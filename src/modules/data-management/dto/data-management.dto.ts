import { IsString, IsNotEmpty, IsOptional, IsArray, IsIn } from 'class-validator';

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

  @IsOptional()
  @IsString()
  backupId?: string;
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

  @IsOptional()
  @IsString()
  backupId?: string;
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
  @IsArray()
  @IsString({ each: true })
  modules?: string[];

  @IsOptional()
  @IsIn(['selected', 'application', 'global'])
  scope?: 'selected' | 'application' | 'global';
}

export class ExecuteResetDto extends ResetPreviewDto {
  @IsString()
  @IsNotEmpty()
  previewToken: string;

  @IsString()
  @IsNotEmpty()
  backupId: string;

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

