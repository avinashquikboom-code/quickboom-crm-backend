-- Safe additive migration: adds completedBy, completedById, scheduledBy, scheduledById to Visit
-- Non-destructive: uses ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "completedBy" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "completedById" INTEGER;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "scheduledBy" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "scheduledById" INTEGER;

CREATE INDEX IF NOT EXISTS "Visit_completedById_idx" ON "Visit"("completedById");
CREATE INDEX IF NOT EXISTS "Visit_scheduledById_idx" ON "Visit"("scheduledById");
