-- Safe additive migration: adds createdFrom enum and fields
-- Non-destructive: uses DO blocks and ADD COLUMN IF NOT EXISTS — safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordCreatedFrom') THEN
    CREATE TYPE "RecordCreatedFrom" AS ENUM ('MOBILE_APP', 'ADMIN_PANEL');
  END IF;
END $$;

ALTER TABLE "DataCaptureJob" ADD COLUMN IF NOT EXISTS "createdFrom" "RecordCreatedFrom";
ALTER TABLE "DataCapturePlace" ADD COLUMN IF NOT EXISTS "createdFrom" "RecordCreatedFrom";
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "createdFrom" "RecordCreatedFrom";

CREATE INDEX IF NOT EXISTS "DataCaptureJob_createdFrom_idx" ON "DataCaptureJob"("createdFrom");
CREATE INDEX IF NOT EXISTS "DataCapturePlace_createdFrom_idx" ON "DataCapturePlace"("createdFrom");
CREATE INDEX IF NOT EXISTS "Lead_createdFrom_idx" ON "Lead"("createdFrom");
