-- The employee reporting-manager field is no longer part of the HRM model.
ALTER TABLE "Employee" DROP COLUMN IF EXISTS "managerId";
