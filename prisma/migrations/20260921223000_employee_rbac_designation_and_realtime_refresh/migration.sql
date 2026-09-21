-- AlterTable: Add designationId and permissionsUpdatedAt to Role
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "designationId" INTEGER;
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "permissionsUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: Add permissionsUpdatedAt to Employee
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "permissionsUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: Add permissionId to employee_module_overrides
ALTER TABLE "employee_module_overrides" ADD COLUMN IF NOT EXISTS "permissionId" INTEGER;

-- CreateIndex: Unique constraint on Role(designationId)
CREATE UNIQUE INDEX IF NOT EXISTS "Role_designationId_key" ON "Role"("designationId");

-- CreateIndex: Index on employee_module_overrides(permissionId)
CREATE INDEX IF NOT EXISTS "employee_module_overrides_permissionId_idx" ON "employee_module_overrides"("permissionId");

-- AddForeignKey: Role -> Designation
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Role_designationId_fkey'
  ) THEN
    ALTER TABLE "Role" ADD CONSTRAINT "Role_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: employee_module_overrides -> Permission
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_module_overrides_permissionId_fkey'
  ) THEN
    ALTER TABLE "employee_module_overrides" ADD CONSTRAINT "employee_module_overrides_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
