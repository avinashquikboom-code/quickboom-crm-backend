-- AlterTable DataCapturePlace
ALTER TABLE "DataCapturePlace" ALTER COLUMN "jobId" DROP NOT NULL;
ALTER TABLE "DataCapturePlace" ALTER COLUMN "googlePlaceId" DROP NOT NULL;
ALTER TABLE "DataCapturePlace" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "DataCapturePlace" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'GOOGLE_PLACES';
ALTER TABLE "DataCapturePlace" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'CAPTURED';
ALTER TABLE "DataCapturePlace" ADD COLUMN IF NOT EXISTS "rawData" JSONB;
ALTER TABLE "DataCapturePlace" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "DataCapturePlace" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DataCapturePlace" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DataCapturePlace_status_idx" ON "DataCapturePlace"("status");
CREATE INDEX IF NOT EXISTS "DataCapturePlace_deletedAt_idx" ON "DataCapturePlace"("deletedAt");
