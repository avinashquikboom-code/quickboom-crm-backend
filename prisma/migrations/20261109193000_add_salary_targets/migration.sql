ALTER TABLE "PayrollItem" ADD COLUMN IF NOT EXISTS "compensationMode" TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE "PayrollItem" ADD COLUMN IF NOT EXISTS "monthlyTarget" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PayrollItem" ADD COLUMN IF NOT EXISTS "achievedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PayrollItem" ADD COLUMN IF NOT EXISTS "eligibleSalary" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PayrollItem" ADD COLUMN IF NOT EXISTS "registeredSalary" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PayrollItem" ADD COLUMN IF NOT EXISTS "belowTargetSalary" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PayrollItem" ADD COLUMN IF NOT EXISTS "targetStatus" TEXT;

CREATE TABLE IF NOT EXISTS "salary_target_policies" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyTarget" DOUBLE PRECISION NOT NULL,
    "fullSalary" DOUBLE PRECISION,
    "belowTargetSalary" DOUBLE PRECISION NOT NULL,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "salary_target_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "salary_target_reviews" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "monthlyTarget" DOUBLE PRECISION NOT NULL,
    "registeredSalary" DOUBLE PRECISION NOT NULL,
    "fullSalary" DOUBLE PRECISION NOT NULL,
    "belowTargetSalary" DOUBLE PRECISION NOT NULL,
    "achievedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "achievementPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eligibleSalary" DOUBLE PRECISION NOT NULL,
    "targetStatus" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "salary_target_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "salary_target_policies_employeeId_key" ON "salary_target_policies"("employeeId");
CREATE INDEX IF NOT EXISTS "salary_target_policies_customerId_idx" ON "salary_target_policies"("customerId");
CREATE UNIQUE INDEX IF NOT EXISTS "salary_target_reviews_customerId_employeeId_month_year_key" ON "salary_target_reviews"("customerId", "employeeId", "month", "year");
CREATE INDEX IF NOT EXISTS "salary_target_reviews_customerId_month_year_idx" ON "salary_target_reviews"("customerId", "month", "year");
CREATE INDEX IF NOT EXISTS "salary_target_reviews_employeeId_idx" ON "salary_target_reviews"("employeeId");

DO $$ BEGIN
  ALTER TABLE "salary_target_policies" ADD CONSTRAINT "salary_target_policies_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salary_target_policies" ADD CONSTRAINT "salary_target_policies_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salary_target_reviews" ADD CONSTRAINT "salary_target_reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salary_target_reviews" ADD CONSTRAINT "salary_target_reviews_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
