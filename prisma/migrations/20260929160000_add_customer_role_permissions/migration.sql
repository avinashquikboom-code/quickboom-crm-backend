-- Customer roles reuse Designation. Existing rows stay employee roles.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DesignationAudience') THEN
    CREATE TYPE "DesignationAudience" AS ENUM ('EMPLOYEE', 'CUSTOMER');
  END IF;
END $$;

ALTER TABLE "Designation" ADD COLUMN IF NOT EXISTS "audience" "DesignationAudience" NOT NULL DEFAULT 'EMPLOYEE';

UPDATE "Designation"
SET "audience" = 'CUSTOMER'
WHERE UPPER("code") = 'CUSTOMER';

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "mobileRoleId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_mobileRoleId_fkey'
  ) THEN
    ALTER TABLE "customers"
      ADD CONSTRAINT "customers_mobileRoleId_fkey"
      FOREIGN KEY ("mobileRoleId") REFERENCES "Designation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "customers_mobileRoleId_idx" ON "customers"("mobileRoleId");

CREATE TABLE IF NOT EXISTS "customer_module_overrides" (
  "id" SERIAL NOT NULL,
  "subjectCustomerId" INTEGER NOT NULL,
  "moduleKey" TEXT NOT NULL,
  "override" "AccessOverrideType" NOT NULL DEFAULT 'INHERIT',
  "permissionId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_module_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_module_overrides_subjectCustomerId_moduleKey_key"
  ON "customer_module_overrides"("subjectCustomerId", "moduleKey");
CREATE INDEX IF NOT EXISTS "customer_module_overrides_subjectCustomerId_idx"
  ON "customer_module_overrides"("subjectCustomerId");
CREATE INDEX IF NOT EXISTS "customer_module_overrides_permissionId_idx"
  ON "customer_module_overrides"("permissionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_module_overrides_subjectCustomerId_fkey'
  ) THEN
    ALTER TABLE "customer_module_overrides"
      ADD CONSTRAINT "customer_module_overrides_subjectCustomerId_fkey"
      FOREIGN KEY ("subjectCustomerId") REFERENCES "customers"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_module_overrides_permissionId_fkey'
  ) THEN
    ALTER TABLE "customer_module_overrides"
      ADD CONSTRAINT "customer_module_overrides_permissionId_fkey"
      FOREIGN KEY ("permissionId") REFERENCES "Permission"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
