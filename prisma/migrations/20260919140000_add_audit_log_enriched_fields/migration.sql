-- Migration: add_audit_log_enriched_fields
-- Production-safe: uses ADD COLUMN IF NOT EXISTS so it is idempotent.
-- Adds all fields added to AuditLog model after the initial schema
-- but never given their own migration SQL.

-- 1. Add missing columns (all nullable/have defaults so existing rows are unaffected)
ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "userName"     TEXT,
  ADD COLUMN IF NOT EXISTS "userRole"     TEXT,
  ADD COLUMN IF NOT EXISTS "source"       TEXT NOT NULL DEFAULT 'ADMIN_PANEL',
  ADD COLUMN IF NOT EXISTS "description"  TEXT,
  ADD COLUMN IF NOT EXISTS "entityType"   TEXT,
  ADD COLUMN IF NOT EXISTS "entityId"     TEXT,
  ADD COLUMN IF NOT EXISTS "endpoint"     TEXT,
  ADD COLUMN IF NOT EXISTS "method"       TEXT,
  ADD COLUMN IF NOT EXISTS "device"       TEXT,
  ADD COLUMN IF NOT EXISTS "status"       TEXT NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;

-- 2. Make "details" nullable (original init created it NOT NULL, new schema has it nullable)
ALTER TABLE "AuditLog" ALTER COLUMN "details" DROP NOT NULL;

-- 3. Add FK to User table if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'AuditLog_userId_fkey'
      AND table_name = 'AuditLog'
  ) THEN
    ALTER TABLE "AuditLog"
      ADD CONSTRAINT "AuditLog_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Add missing indexes (idempotent)
CREATE INDEX IF NOT EXISTS "AuditLog_source_idx"              ON "AuditLog"("source");
CREATE INDEX IF NOT EXISTS "AuditLog_userRole_idx"            ON "AuditLog"("userRole");
CREATE INDEX IF NOT EXISTS "AuditLog_module_idx"              ON "AuditLog"("module");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx"              ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_status_idx"              ON "AuditLog"("status");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx"           ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx"              ON "AuditLog"("userId");
CREATE INDEX IF NOT EXISTS "AuditLog_customerId_idx"          ON "AuditLog"("customerId");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
