-- AlterTable: telecaller_target_policies
ALTER TABLE "telecaller_target_policies"
  ALTER COLUMN "autoSendOnFinalPunchOut" SET DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reportDeliveryTime" TEXT NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS "reportTimezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS "poorThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS "goodThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailTemplatePoor" TEXT NOT NULL DEFAULT 'daily_performance_poor',
  ADD COLUMN IF NOT EXISTS "emailTemplateAverage" TEXT NOT NULL DEFAULT 'daily_performance_average',
  ADD COLUMN IF NOT EXISTS "emailTemplateGood" TEXT NOT NULL DEFAULT 'daily_performance_good',
  ADD COLUMN IF NOT EXISTS "whatsappTemplatePoor" TEXT NOT NULL DEFAULT 'daily_performance_poor',
  ADD COLUMN IF NOT EXISTS "whatsappTemplateAverage" TEXT NOT NULL DEFAULT 'daily_performance_average',
  ADD COLUMN IF NOT EXISTS "whatsappTemplateGood" TEXT NOT NULL DEFAULT 'daily_performance_good',
  ADD COLUMN IF NOT EXISTS "pushTitlePoor" TEXT,
  ADD COLUMN IF NOT EXISTS "pushBodyPoor" TEXT,
  ADD COLUMN IF NOT EXISTS "pushTitleAverage" TEXT,
  ADD COLUMN IF NOT EXISTS "pushBodyAverage" TEXT,
  ADD COLUMN IF NOT EXISTS "pushTitleGood" TEXT,
  ADD COLUMN IF NOT EXISTS "pushBodyGood" TEXT;

-- AlterTable: daily_performance_reports
ALTER TABLE "daily_performance_reports"
  ADD COLUMN IF NOT EXISTS "classification" TEXT NOT NULL DEFAULT 'AVERAGE',
  ADD COLUMN IF NOT EXISTS "isProvisional" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pushStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "pushAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pushError" TEXT,
  ADD COLUMN IF NOT EXISTS "pushSentAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "daily_performance_reports_emailStatus_whatsappStatus_pushStatus_nextRetryAt_idx"
  ON "daily_performance_reports"("emailStatus", "whatsappStatus", "pushStatus", "nextRetryAt");

-- CreateTable: daily_performance_schedule_runs
CREATE TABLE IF NOT EXISTS "daily_performance_schedule_runs" (
  "id" SERIAL NOT NULL,
  "customerId" INTEGER NOT NULL,
  "businessDate" TEXT NOT NULL,
  "scheduledTime" TEXT NOT NULL DEFAULT '22:00',
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "daily_performance_schedule_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_performance_schedule_runs_customerId_businessDate_key"
  ON "daily_performance_schedule_runs"("customerId", "businessDate");

CREATE INDEX IF NOT EXISTS "daily_performance_schedule_runs_businessDate_status_idx"
  ON "daily_performance_schedule_runs"("businessDate", "status");
