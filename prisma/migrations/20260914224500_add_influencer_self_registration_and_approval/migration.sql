-- AlterTable influencers
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "userId" INTEGER;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "socialLinks" JSONB;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "approvedBy" INTEGER;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "rejectedBy" INTEGER;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "suspendedBy" INTEGER;

-- Alter default status on influencers table to PENDING
ALTER TABLE "influencers" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "influencers_email_key" ON "influencers"("email");
CREATE INDEX IF NOT EXISTS "influencers_status_idx" ON "influencers"("status");
CREATE INDEX IF NOT EXISTS "influencers_email_idx" ON "influencers"("email");

-- Transition existing ACTIVE influencers to APPROVED so existing catalog remains visible and bookable
UPDATE "influencers" SET "status" = 'APPROVED' WHERE "status" = 'ACTIVE';
