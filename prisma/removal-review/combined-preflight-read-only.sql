-- READ ONLY preflight for combined removal; run only against the intended old-schema database.
-- No data is changed by these queries.

-- Product global uniqueness: sku
SELECT "sku", COUNT(*) AS duplicate_count FROM "Product" WHERE "sku" IS NOT NULL GROUP BY "sku" HAVING COUNT(*) > 1;

-- FeatureToggle global uniqueness: feature
SELECT "feature", COUNT(*) AS duplicate_count FROM "FeatureToggle" WHERE "feature" IS NOT NULL GROUP BY "feature" HAVING COUNT(*) > 1;

-- Department global uniqueness: code
SELECT "code", COUNT(*) AS duplicate_count FROM "Department" WHERE "code" IS NOT NULL GROUP BY "code" HAVING COUNT(*) > 1;

-- Designation global uniqueness: code
SELECT "code", COUNT(*) AS duplicate_count FROM "Designation" WHERE "code" IS NOT NULL GROUP BY "code" HAVING COUNT(*) > 1;

-- Employee global uniqueness: employeeCode
SELECT "employeeCode", COUNT(*) AS duplicate_count FROM "Employee" WHERE "employeeCode" IS NOT NULL GROUP BY "employeeCode" HAVING COUNT(*) > 1;

-- LeaveType global uniqueness: code
SELECT "code", COUNT(*) AS duplicate_count FROM "LeaveType" WHERE "code" IS NOT NULL GROUP BY "code" HAVING COUNT(*) > 1;

-- Shift global uniqueness: code
SELECT "code", COUNT(*) AS duplicate_count FROM "Shift" WHERE "code" IS NOT NULL GROUP BY "code" HAVING COUNT(*) > 1;

-- Payroll global uniqueness: month, year, departmentId
SELECT "month", "year", "departmentId", COUNT(*) AS duplicate_count FROM "Payroll" WHERE "month" IS NOT NULL AND "year" IS NOT NULL AND "departmentId" IS NOT NULL GROUP BY "month", "year", "departmentId" HAVING COUNT(*) > 1;

-- More than one old tenant record requires an explicit consolidation decision.
SELECT COUNT(*) AS existing_rows FROM "PayrollPolicy" HAVING COUNT(*) > 1;

-- More than one old tenant record requires an explicit consolidation decision.
SELECT COUNT(*) AS existing_rows FROM "ai_credit_wallets" HAVING COUNT(*) > 1;

-- SocialAccount global uniqueness: platform, externalAccountId
SELECT "platform", "externalAccountId", COUNT(*) AS duplicate_count FROM "social_accounts" WHERE "platform" IS NOT NULL AND "externalAccountId" IS NOT NULL GROUP BY "platform", "externalAccountId" HAVING COUNT(*) > 1;

-- MasterItem global uniqueness: type, code
SELECT "type", "code", COUNT(*) AS duplicate_count FROM "master_items" WHERE "type" IS NOT NULL AND "code" IS NOT NULL GROUP BY "type", "code" HAVING COUNT(*) > 1;

SELECT conrelid::regclass AS child_table, confrelid::regclass AS parent_table, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype = 'f' ORDER BY parent_table::text, child_table::text, conname;
SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at;

-- Review administrator identity before removing Role/UserRole.
SELECT u.id, u.email, r.name, r.type::text
FROM "User" u JOIN "UserRole" ur ON ur."userId" = u.id
JOIN "Role" r ON r.id = ur."roleId"
WHERE u."deletedAt" IS NULL AND r."deletedAt" IS NULL
AND (r.type::text IN ('SUPER_ADMIN', 'TENANT_ADMIN') OR
  regexp_replace(upper(r.name), '[^A-Z]', '', 'g') IN
  ('SUPERADMIN','SUPERADMINISTRATOR','ADMIN','COMPANYADMIN','TENANTADMIN'));
