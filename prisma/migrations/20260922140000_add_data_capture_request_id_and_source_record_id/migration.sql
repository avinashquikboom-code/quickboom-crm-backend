-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "captureRequestId" TEXT,
ADD COLUMN "sourceRecordId" TEXT;

-- AlterTable
ALTER TABLE "DataCapturePlace" ADD COLUMN "captureRequestId" TEXT,
ADD COLUMN "sourceRecordId" TEXT;

-- CreateIndex
CREATE INDEX "Lead_captureRequestId_idx" ON "Lead"("captureRequestId");

-- CreateIndex
CREATE INDEX "DataCapturePlace_captureRequestId_idx" ON "DataCapturePlace"("captureRequestId");
