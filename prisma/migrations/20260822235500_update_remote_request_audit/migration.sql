-- AlterTable
ALTER TABLE "RemoteRequest" 
ADD COLUMN "approvedByName" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "rejectedById" INTEGER,
ADD COLUMN "rejectedByName" TEXT,
ADD COLUMN "rejectedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RemoteRequest_fromDate_idx" ON "RemoteRequest"("fromDate");

-- CreateIndex
CREATE INDEX "RemoteRequest_toDate_idx" ON "RemoteRequest"("toDate");
