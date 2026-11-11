-- Additive HRM attendance and leave report tables. Existing rows are not changed.

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "whatsappReportsOptIn" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "HrmReportType" AS ENUM ('ATTENDANCE', 'LEAVE_BALANCE', 'SALARY_SUMMARY');
CREATE TYPE "HrmReportStatus" AS ENUM ('PENDING', 'GENERATING', 'GENERATED', 'COMPLETED', 'FAILED');
CREATE TYPE "HrmNotificationChannel" AS ENUM ('EMAIL', 'WHATSAPP');
CREATE TYPE "HrmNotificationKind" AS ENUM ('MONTHLY_ATTENDANCE', 'MONTHLY_LEAVE_BALANCE', 'MONTHLY_SALARY', 'MONTHLY_REPORTS', 'LEAVE_APPROVED', 'LEAVE_REJECTED');
CREATE TYPE "HrmDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

CREATE TABLE IF NOT EXISTS "hrm_report_settings" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "attendanceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "leaveEnabled" BOOLEAN NOT NULL DEFAULT true,
    "salaryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryTime" TEXT NOT NULL DEFAULT '18:30',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "graceHours" INTEGER NOT NULL DEFAULT 2,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hrm_report_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hrm_monthly_report_runs" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "HrmReportStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hrm_monthly_report_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hrm_employee_monthly_reports" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "runId" INTEGER,
    "employeeId" INTEGER NOT NULL,
    "payrollId" INTEGER,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "reportType" "HrmReportType" NOT NULL,
    "status" "HrmReportStatus" NOT NULL DEFAULT 'PENDING',
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "fileUrl" TEXT,
    "summary" JSONB,
    "generatedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hrm_employee_monthly_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hrm_leave_monthly_snapshots" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "leaveTypeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "opening" DECIMAL(8,2) NOT NULL,
    "credited" DECIMAL(8,2) NOT NULL,
    "carryForward" DECIMAL(8,2) NOT NULL,
    "taken" DECIMAL(8,2) NOT NULL,
    "adjustments" DECIMAL(8,2) NOT NULL,
    "expired" DECIMAL(8,2) NOT NULL,
    "unpaid" DECIMAL(8,2) NOT NULL,
    "closing" DECIMAL(8,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hrm_leave_monthly_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hrm_notification_deliveries" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "reportId" INTEGER,
    "leaveRequestId" INTEGER,
    "channel" "HrmNotificationChannel" NOT NULL,
    "kind" "HrmNotificationKind" NOT NULL,
    "status" "HrmDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hrm_notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hrm_notification_templates" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "kind" "HrmNotificationKind" NOT NULL,
    "channel" "HrmNotificationChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hrm_notification_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hrm_notification_outbox" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "HrmDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hrm_notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hrm_report_settings_customerId_key" ON "hrm_report_settings"("customerId");
CREATE UNIQUE INDEX "hrm_monthly_report_runs_idempotencyKey_key" ON "hrm_monthly_report_runs"("idempotencyKey");
CREATE UNIQUE INDEX "hrm_monthly_report_runs_customerId_year_month_key" ON "hrm_monthly_report_runs"("customerId", "year", "month");
CREATE INDEX "hrm_monthly_report_runs_customerId_status_idx" ON "hrm_monthly_report_runs"("customerId", "status");
CREATE UNIQUE INDEX "hrm_employee_monthly_reports_customerId_employeeId_year_month_reportType_key" ON "hrm_employee_monthly_reports"("customerId", "employeeId", "year", "month", "reportType");
CREATE INDEX "hrm_employee_monthly_reports_customerId_year_month_idx" ON "hrm_employee_monthly_reports"("customerId", "year", "month");
CREATE INDEX "hrm_employee_monthly_reports_employeeId_idx" ON "hrm_employee_monthly_reports"("employeeId");
CREATE INDEX IF NOT EXISTS "hrm_employee_monthly_reports_payrollId_idx" ON "hrm_employee_monthly_reports"("payrollId");

DO $$ BEGIN
    ALTER TABLE "hrm_employee_monthly_reports" ADD CONSTRAINT "hrm_employee_monthly_reports_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
CREATE UNIQUE INDEX "hrm_leave_monthly_snapshots_employeeId_leaveTypeId_year_month_key" ON "hrm_leave_monthly_snapshots"("employeeId", "leaveTypeId", "year", "month");
CREATE INDEX "hrm_leave_monthly_snapshots_customerId_year_month_idx" ON "hrm_leave_monthly_snapshots"("customerId", "year", "month");
CREATE UNIQUE INDEX "hrm_notification_deliveries_idempotencyKey_key" ON "hrm_notification_deliveries"("idempotencyKey");
CREATE INDEX "hrm_notification_deliveries_customerId_status_idx" ON "hrm_notification_deliveries"("customerId", "status");
CREATE INDEX "hrm_notification_deliveries_employeeId_idx" ON "hrm_notification_deliveries"("employeeId");
CREATE INDEX "hrm_notification_deliveries_providerMessageId_idx" ON "hrm_notification_deliveries"("providerMessageId");
CREATE UNIQUE INDEX "hrm_notification_templates_customerId_kind_channel_key" ON "hrm_notification_templates"("customerId", "kind", "channel");
CREATE UNIQUE INDEX "hrm_notification_outbox_idempotencyKey_key" ON "hrm_notification_outbox"("idempotencyKey");
CREATE INDEX "hrm_notification_outbox_status_availableAt_idx" ON "hrm_notification_outbox"("status", "availableAt");

ALTER TABLE "hrm_report_settings" ADD CONSTRAINT "hrm_report_settings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hrm_monthly_report_runs" ADD CONSTRAINT "hrm_monthly_report_runs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hrm_employee_monthly_reports" ADD CONSTRAINT "hrm_employee_monthly_reports_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hrm_employee_monthly_reports" ADD CONSTRAINT "hrm_employee_monthly_reports_runId_fkey" FOREIGN KEY ("runId") REFERENCES "hrm_monthly_report_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hrm_employee_monthly_reports" ADD CONSTRAINT "hrm_employee_monthly_reports_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hrm_leave_monthly_snapshots" ADD CONSTRAINT "hrm_leave_monthly_snapshots_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hrm_leave_monthly_snapshots" ADD CONSTRAINT "hrm_leave_monthly_snapshots_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hrm_leave_monthly_snapshots" ADD CONSTRAINT "hrm_leave_monthly_snapshots_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hrm_notification_deliveries" ADD CONSTRAINT "hrm_notification_deliveries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hrm_notification_deliveries" ADD CONSTRAINT "hrm_notification_deliveries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hrm_notification_deliveries" ADD CONSTRAINT "hrm_notification_deliveries_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "hrm_employee_monthly_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hrm_notification_templates" ADD CONSTRAINT "hrm_notification_templates_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hrm_notification_outbox" ADD CONSTRAINT "hrm_notification_outbox_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
