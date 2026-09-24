-- Safe additive migration: adds optional Google photo URLs to DataCapturePlace
-- This column stores an array of resolved Google photo URLs (JSONB).
-- Non-destructive: uses ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE "DataCapturePlace" ADD COLUMN IF NOT EXISTS "photos" JSONB;
