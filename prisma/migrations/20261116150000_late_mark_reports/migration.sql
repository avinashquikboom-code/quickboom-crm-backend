ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "lateDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "lateRatePerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "lateGraceMinutes" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "LateMarkReportSetting" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL UNIQUE,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
  "dailyEnabled" BOOLEAN NOT NULL DEFAULT false,
  "weeklyEnabled" BOOLEAN NOT NULL DEFAULT false,
  "monthlyEnabled" BOOLEAN NOT NULL DEFAULT false,
  "dailySendHour" INTEGER NOT NULL DEFAULT 23,
  "dailySendMinute" INTEGER NOT NULL DEFAULT 0,
  "weeklySendHour" INTEGER NOT NULL DEFAULT 9,
  "weeklySendMinute" INTEGER NOT NULL DEFAULT 0,
  "monthlySendHour" INTEGER NOT NULL DEFAULT 9,
  "monthlySendMinute" INTEGER NOT NULL DEFAULT 0,
  "recipients" TEXT NOT NULL DEFAULT '',
  "cc" TEXT NOT NULL DEFAULT '',
  "includeEmployeeDetails" BOOLEAN NOT NULL DEFAULT true,
  "includeCsv" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LateMarkReportSetting_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "LateMarkReportDelivery" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "periodLabel" TEXT NOT NULL,
  "recipients" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "failureReason" TEXT,
  "sentAt" TIMESTAMP(3),
  "attachmentName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "LateMarkReportDelivery_customerId_kind_periodKey_key"
  ON "LateMarkReportDelivery"("customerId", "kind", "periodKey");
CREATE INDEX IF NOT EXISTS "LateMarkReportDelivery_customerId_status_idx"
  ON "LateMarkReportDelivery"("customerId", "status");
