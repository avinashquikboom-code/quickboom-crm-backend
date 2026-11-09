-- Existing policies remain period 0/0 defaults. No payroll/review data is changed.
ALTER TABLE "salary_target_policies" ADD COLUMN "month" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "year" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "deletedAt" TIMESTAMP(3);
DROP INDEX "salary_target_policies_employeeId_key";
CREATE UNIQUE INDEX "salary_target_policies_customerId_employeeId_month_year_key"
 ON "salary_target_policies"("customerId", "employeeId", "month", "year");
ALTER TABLE "salary_target_policies" ADD CONSTRAINT "salary_target_policy_period_check"
 CHECK (("month" = 0 AND "year" = 0) OR ("month" BETWEEN 1 AND 12 AND "year" BETWEEN 2000 AND 9999));
