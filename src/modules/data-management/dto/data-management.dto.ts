import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

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

