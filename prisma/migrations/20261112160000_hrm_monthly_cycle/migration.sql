ALTER TYPE "HrmReportType" ADD VALUE IF NOT EXISTS 'COMMISSION';
ALTER TYPE "HrmNotificationKind" ADD VALUE IF NOT EXISTS 'MONTHLY_COMMISSION';

ALTER TABLE "hrm_report_settings" ADD COLUMN IF NOT EXISTS "commissionEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "hrm_monthly_cycles" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "attendanceStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "payrollStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "commissionStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "idempotencyKey" TEXT NOT NULL,
    "initializedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hrm_monthly_cycles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hrm_monthly_cycles_idempotencyKey_key" ON "hrm_monthly_cycles"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "hrm_monthly_cycles_customerId_year_month_key" ON "hrm_monthly_cycles"("customerId", "year", "month");
CREATE INDEX IF NOT EXISTS "hrm_monthly_cycles_customerId_year_month_idx" ON "hrm_monthly_cycles"("customerId", "year", "month");

CREATE TABLE IF NOT EXISTS "hrm_commission_monthly_snapshots" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "generated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "employeeShare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leaderShare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approved" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outstanding" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reversed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "lines" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hrm_commission_monthly_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hrm_commission_monthly_snapshots_customerId_employeeId_year_month_key" ON "hrm_commission_monthly_snapshots"("customerId", "employeeId", "year", "month");
CREATE INDEX IF NOT EXISTS "hrm_commission_monthly_snapshots_customerId_year_month_idx" ON "hrm_commission_monthly_snapshots"("customerId", "year", "month");

DO $$ BEGIN
  ALTER TABLE "hrm_monthly_cycles" ADD CONSTRAINT "hrm_monthly_cycles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hrm_commission_monthly_snapshots" ADD CONSTRAINT "hrm_commission_monthly_snapshots_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hrm_commission_monthly_snapshots" ADD CONSTRAINT "hrm_commission_monthly_snapshots_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
