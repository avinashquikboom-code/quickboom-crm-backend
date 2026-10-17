-- READ ONLY preflight. Review results before approving destructive changes.
-- Targets the OLD schema. Does not modify data.

-- Global uniqueness collision check: Product @@unique([sku])
SELECT "sku", COUNT(*) AS duplicate_count FROM "Product" WHERE "sku" IS NOT NULL GROUP BY "sku" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: FeatureToggle @@unique([feature])
SELECT "feature", COUNT(*) AS duplicate_count FROM "FeatureToggle" WHERE "feature" IS NOT NULL GROUP BY "feature" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: Department @@unique([code])
SELECT "code", COUNT(*) AS duplicate_count FROM "Department" WHERE "code" IS NOT NULL GROUP BY "code" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: Designation @@unique([code])
SELECT "code", COUNT(*) AS duplicate_count FROM "Designation" WHERE "code" IS NOT NULL GROUP BY "code" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: Employee @@unique([employeeCode])
SELECT "employeeCode", COUNT(*) AS duplicate_count FROM "Employee" WHERE "employeeCode" IS NOT NULL GROUP BY "employeeCode" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: LeaveType @@unique([code])
SELECT "code", COUNT(*) AS duplicate_count FROM "LeaveType" WHERE "code" IS NOT NULL GROUP BY "code" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: Shift @@unique([code])
SELECT "code", COUNT(*) AS duplicate_count FROM "Shift" WHERE "code" IS NOT NULL GROUP BY "code" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: Payroll @@unique([month, year, departmentId])
SELECT "month", "year", "departmentId", COUNT(*) AS duplicate_count FROM "Payroll" WHERE "month" IS NOT NULL AND "year" IS NOT NULL AND "departmentId" IS NOT NULL GROUP BY "month", "year", "departmentId" HAVING COUNT(*) > 1;

-- Multiple prior tenant records cannot silently become a shared singleton.
SELECT COUNT(*) AS existing_rows FROM "PayrollPolicy" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: RoleWorkPermission @@unique([roleName, workModule])
SELECT "roleName", "workModule", COUNT(*) AS duplicate_count FROM "role_work_permissions" WHERE "roleName" IS NOT NULL AND "workModule" IS NOT NULL GROUP BY "roleName", "workModule" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: EmployeeModuleOverride @@unique([employeeId, moduleKey])
SELECT "employeeId", "moduleKey", COUNT(*) AS duplicate_count FROM "employee_module_overrides" WHERE "employeeId" IS NOT NULL AND "moduleKey" IS NOT NULL GROUP BY "employeeId", "moduleKey" HAVING COUNT(*) > 1;

-- Multiple prior tenant records cannot silently become a shared singleton.
SELECT COUNT(*) AS existing_rows FROM "ai_credit_wallets" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: SocialAccount @@unique([platform, externalAccountId])
SELECT "platform", "externalAccountId", COUNT(*) AS duplicate_count FROM "social_accounts" WHERE "platform" IS NOT NULL AND "externalAccountId" IS NOT NULL GROUP BY "platform", "externalAccountId" HAVING COUNT(*) > 1;

-- Global uniqueness collision check: MasterItem @@unique([type, code])
SELECT "type", "code", COUNT(*) AS duplicate_count FROM "master_items" WHERE "type" IS NOT NULL AND "code" IS NOT NULL GROUP BY "type", "code" HAVING COUNT(*) > 1;

-- Verify actual incoming foreign keys; compare with proposed SQL before execution.
SELECT conrelid::regclass AS child_table, confrelid::regclass AS parent_table, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype = 'f' ORDER BY parent_table::text, child_table::text, conname;

-- Verify applied migration history separately on the intended target.
SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at;
