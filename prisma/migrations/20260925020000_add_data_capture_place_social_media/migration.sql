-- Safe additive migration: adds optional socialMedia JSONB to DataCapturePlace
-- This column stores discovered social media handles & website (JSONB).
-- Non-destructive: uses ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE "DataCapturePlace" ADD COLUMN IF NOT EXISTS "socialMedia" JSONB;
