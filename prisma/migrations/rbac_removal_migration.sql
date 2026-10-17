-- ============================================================================
-- SQL MIGRATION SCRIPT: REMOVAL OF ROLE AND PERMISSION SCHEMA
-- ============================================================================
-- IMPORTANT: Review before executing on production.
-- This script safely drops foreign keys and tables for the removed Role/Permission
-- and module override models without affecting Work, WorkTask, MonthlySchedule,
-- Employee, Team, or Calendar data.
-- ============================================================================

-- Step 1: Drop Foreign Key Constraints (if existing)
ALTER TABLE IF EXISTS "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_user_id_fkey";
ALTER TABLE IF EXISTS "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_id_fkey";

ALTER TABLE IF EXISTS "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_role_id_fkey";
ALTER TABLE IF EXISTS "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_permission_id_fkey";

ALTER TABLE IF EXISTS "employee_module_overrides" DROP CONSTRAINT IF EXISTS "employee_module_overrides_employee_id_fkey";
ALTER TABLE IF EXISTS "employee_module_overrides" DROP CONSTRAINT IF EXISTS "employee_module_overrides_permission_id_fkey";

ALTER TABLE IF EXISTS "customer_module_overrides" DROP CONSTRAINT IF EXISTS "customer_module_overrides_permission_id_fkey";

ALTER TABLE IF EXISTS "roles" DROP CONSTRAINT IF EXISTS "roles_designation_id_fkey";
ALTER TABLE IF EXISTS "designations" DROP CONSTRAINT IF EXISTS "designations_role_id_fkey";

-- Step 2: Drop Tables
DROP TABLE IF EXISTS "role_permissions" CASCADE;
DROP TABLE IF EXISTS "user_roles" CASCADE;
DROP TABLE IF EXISTS "role_work_permissions" CASCADE;
DROP TABLE IF EXISTS "employee_module_overrides" CASCADE;
DROP TABLE IF EXISTS "customer_module_overrides" CASCADE;
DROP TABLE IF EXISTS "permissions" CASCADE;
DROP TABLE IF EXISTS "roles" CASCADE;

-- Step 3: Drop Deprecated Enums (if no longer used in any column)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RoleType') THEN
        DROP TYPE "RoleType";
    END IF;
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccessOverrideType') THEN
        DROP TYPE "AccessOverrideType";
    END IF;
END $$;
