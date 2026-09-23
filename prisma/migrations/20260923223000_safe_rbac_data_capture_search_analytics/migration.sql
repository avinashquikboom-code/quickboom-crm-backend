-- Safe Non-Destructive Migration: RBAC Overrides, Data Capture Permissions & Employee Search Analytics

-- 1. Support INHERIT in AccessOverrideType enum
ALTER TYPE "AccessOverrideType" ADD VALUE IF NOT EXISTS 'INHERIT';

-- 2. Create DataCaptureSearch Table (if not exists)
CREATE TABLE IF NOT EXISTS "DataCaptureSearch" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "userId" INTEGER,
    "searchQuery" TEXT NOT NULL,
    "location" TEXT,
    "requestId" TEXT,
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataCaptureSearch_pkey" PRIMARY KEY ("id")
);

-- 3. Create Indexes for DataCaptureSearch
CREATE INDEX IF NOT EXISTS "DataCaptureSearch_customerId_idx" ON "DataCaptureSearch"("customerId");
CREATE INDEX IF NOT EXISTS "DataCaptureSearch_employeeId_idx" ON "DataCaptureSearch"("employeeId");
CREATE INDEX IF NOT EXISTS "DataCaptureSearch_customerId_employeeId_idx" ON "DataCaptureSearch"("customerId", "employeeId");
CREATE INDEX IF NOT EXISTS "DataCaptureSearch_requestId_idx" ON "DataCaptureSearch"("requestId");
CREATE INDEX IF NOT EXISTS "DataCaptureSearch_searchedAt_idx" ON "DataCaptureSearch"("searchedAt");
CREATE INDEX IF NOT EXISTS "DataCaptureSearch_customerId_employeeId_searchedAt_idx" ON "DataCaptureSearch"("customerId", "employeeId", "searchedAt");

-- 4. Safe Foreign Keys (Only add if constraint does not exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DataCaptureSearch_customerId_fkey'
    ) THEN
        ALTER TABLE "DataCaptureSearch" ADD CONSTRAINT "DataCaptureSearch_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DataCaptureSearch_employeeId_fkey'
    ) THEN
        ALTER TABLE "DataCaptureSearch" ADD CONSTRAINT "DataCaptureSearch_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 5. Idempotent Data Capture Permissions (Create ONLY if missing, preserve existing IDs & timestamps)
INSERT INTO "Permission" ("module", "action", "description", "createdAt", "updatedAt")
VALUES
    ('DATA_CAPTURE', 'VIEW', 'Display Data Capture screen, search places, and view extraction history', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('DATA_CAPTURE', 'CREATE', 'Trigger new Google Places extraction or manually add prospect record', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('DATA_CAPTURE', 'EDIT', 'Edit captured prospect, validate status, or import to CRM Leads', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('DATA_CAPTURE', 'DELETE', 'Delete captured prospect records or extraction jobs', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("module", "action") DO UPDATE
SET "description" = EXCLUDED."description",
    "updatedAt" = CURRENT_TIMESTAMP;
