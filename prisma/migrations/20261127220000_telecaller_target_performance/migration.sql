-- Telecaller Target and Performance Management System
CREATE TABLE IF NOT EXISTS "telecaller_target_policies" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL UNIQUE REFERENCES "customers"("id") ON DELETE CASCADE,
  "adjustForHalfDayLeave" BOOLEAN NOT NULL DEFAULT true,
  "excludeFullDayLeave" BOOLEAN NOT NULL DEFAULT true,
  "excludeHolidays" BOOLEAN NOT NULL DEFAULT true,
  "excludeWeeklyOff" BOOLEAN NOT NULL DEFAULT true,
  "autoSendOnFinalPunchOut" BOOLEAN NOT NULL DEFAULT true,
  "emailTemplateKey" TEXT,
  "emailSubjectTemplate" TEXT,
  "whatsappTemplateName" TEXT,
  "whatsappLanguageCode" TEXT NOT NULL DEFAULT 'en_US',
  "whatsappVariableMapping" JSONB,
  "maxRetryAttempts" INTEGER NOT NULL DEFAULT 3,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "telecaller_target_assignments" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "employeeId" INTEGER REFERENCES "Employee"("id") ON DELETE CASCADE,
  "departmentId" INTEGER,
  "metricKey" TEXT NOT NULL,
  "metricLabel" TEXT NOT NULL,
  "periodType" TEXT NOT NULL DEFAULT 'DAILY',
  "targetValue" DOUBLE PRECISION NOT NULL,
  "weightage" DOUBLE PRECISION,
  "effectiveDate" TIMESTAMP(3) NOT NULL,
  "expiryDate" TIMESTAMP(3),
  "recurrence" TEXT NOT NULL DEFAULT 'RECURRING',
  "isOverride" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "assignedById" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "telecaller_target_assignments_emp_idx"
  ON "telecaller_target_assignments" ("customerId", "employeeId", "periodType", "isActive");
CREATE INDEX IF NOT EXISTS "telecaller_target_assignments_dept_idx"
  ON "telecaller_target_assignments" ("customerId", "departmentId", "periodType", "isActive");
CREATE INDEX IF NOT EXISTS "telecaller_target_assignments_metric_idx"
  ON "telecaller_target_assignments" ("customerId", "metricKey", "effectiveDate");

CREATE TABLE IF NOT EXISTS "telecaller_target_histories" (
  "id" SERIAL PRIMARY KEY,
  "assignmentId" INTEGER NOT NULL REFERENCES "telecaller_target_assignments"("id") ON DELETE CASCADE,
  "customerId" INTEGER NOT NULL,
  "changedById" INTEGER,
  "action" TEXT NOT NULL,
  "previousData" JSONB,
  "newData" JSONB NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "telecaller_target_histories_assign_idx"
  ON "telecaller_target_histories" ("assignmentId", "createdAt");

CREATE TABLE IF NOT EXISTS "telecaller_activity_events" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "employeeId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "metricKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "businessDate" TEXT NOT NULL,
  "callStatus" TEXT,
  "durationSeconds" INTEGER,
  "isVerified" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "telecaller_activity_events_lookup_idx"
  ON "telecaller_activity_events" ("customerId", "employeeId", "businessDate", "metricKey");

CREATE TABLE IF NOT EXISTS "daily_performance_snapshots" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "employeeId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "businessDate" TEXT NOT NULL,
  "shiftId" INTEGER,
  "shiftName" TEXT,
  "attendanceStatus" TEXT,
  "punchIn" TIMESTAMP(3),
  "punchOut" TIMESTAMP(3),
  "workingHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isHalfDayLeave" BOOLEAN NOT NULL DEFAULT false,
  "isFullDayLeave" BOOLEAN NOT NULL DEFAULT false,
  "isHoliday" BOOLEAN NOT NULL DEFAULT false,
  "isWeeklyOff" BOOLEAN NOT NULL DEFAULT false,
  "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "callConnectionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "leadConversionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "metricBreakdown" JSONB NOT NULL,
  "totals" JSONB NOT NULL,
  "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("customerId", "employeeId", "businessDate")
);

CREATE TABLE IF NOT EXISTS "daily_performance_reports" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "employeeId" INTEGER NOT NULL REFERENCES "Employee"("id") ON DELETE CASCADE,
  "businessDate" TEXT NOT NULL,
  "reportVersion" INTEGER NOT NULL DEFAULT 1,
  "triggerKey" TEXT NOT NULL UNIQUE,
  "pdfUrl" TEXT,
  "pdfStorageKey" TEXT,
  "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  "emailError" TEXT,
  "emailSentAt" TIMESTAMP(3),
  "whatsappStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "whatsappAttempts" INTEGER NOT NULL DEFAULT 0,
  "whatsappError" TEXT,
  "whatsappSentAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "snapshotData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("customerId", "employeeId", "businessDate", "reportVersion")
);
