-- Hiring Form & Recruitment Management Module
CREATE TABLE IF NOT EXISTS "hiring_forms" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "token" TEXT NOT NULL UNIQUE,
  "departmentIds" JSONB,
  "fieldConfig" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "submissionCount" INTEGER NOT NULL DEFAULT 0,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "hiring_forms_customer_idx"
  ON "hiring_forms" ("customerId", "isActive");

CREATE TABLE IF NOT EXISTS "candidate_applications" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "hiringFormId" INTEGER REFERENCES "hiring_forms"("id") ON DELETE SET NULL,
  "source" TEXT NOT NULL DEFAULT 'PUBLIC_FORM',
  "candidateName" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL DEFAULT '+91',
  "mobileNumber" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "departmentId" INTEGER,
  "departmentName" TEXT,
  "currentSalary" DOUBLE PRECISION,
  "expectedSalary" DOUBLE PRECISION,
  "experience" TEXT,
  "resumeKey" TEXT,
  "resumeUrl" TEXT,
  "resumeFilename" TEXT,
  "interviewDate" TEXT,
  "interviewTime" TEXT,
  "interviewMode" TEXT,
  "interviewLocation" TEXT,
  "meetingLink" TEXT,
  "interviewStatus" TEXT NOT NULL DEFAULT 'NEW_APPLICATION',
  "remarks" TEXT,
  "assignedHrId" INTEGER,
  "assignedHrName" TEXT,
  "convertedEmployeeId" INTEGER,
  "dedupeKey" TEXT,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "candidate_applications_status_idx"
  ON "candidate_applications" ("customerId", "interviewStatus");
CREATE INDEX IF NOT EXISTS "candidate_applications_dept_idx"
  ON "candidate_applications" ("customerId", "departmentId");
CREATE INDEX IF NOT EXISTS "candidate_applications_dedupe_idx"
  ON "candidate_applications" ("customerId", "dedupeKey");

CREATE TABLE IF NOT EXISTS "candidate_interviews" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "applicationId" INTEGER NOT NULL REFERENCES "candidate_applications"("id") ON DELETE CASCADE,
  "interviewDate" TEXT NOT NULL,
  "interviewTime" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'IN_PERSON',
  "location" TEXT,
  "meetingLink" TEXT,
  "interviewerName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "notes" TEXT,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "candidate_status_histories" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "applicationId" INTEGER NOT NULL REFERENCES "candidate_applications"("id") ON DELETE CASCADE,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "changedById" INTEGER,
  "changedByName" TEXT,
  "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "candidate_notification_logs" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "applicationId" INTEGER NOT NULL REFERENCES "candidate_applications"("id") ON DELETE CASCADE,
  "eventType" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
