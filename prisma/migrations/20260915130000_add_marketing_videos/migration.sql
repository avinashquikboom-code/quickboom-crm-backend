-- CreateTable
CREATE TABLE "marketing_videos" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "videoUrl" TEXT NOT NULL,
    "videoKey" TEXT,
    "thumbnailUrl" TEXT,
    "thumbnailKey" TEXT,
    "ctaText" TEXT,
    "ctaUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdBy" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "marketing_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_videos_customerId_isActive_status_idx" ON "marketing_videos"("customerId", "isActive", "status");

-- CreateIndex
CREATE INDEX "marketing_videos_priority_idx" ON "marketing_videos"("priority");

-- CreateIndex
CREATE INDEX "marketing_videos_startAt_endAt_idx" ON "marketing_videos"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "marketing_videos_deletedAt_idx" ON "marketing_videos"("deletedAt");

-- AddForeignKey
ALTER TABLE "marketing_videos" ADD CONSTRAINT "marketing_videos_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_videos" ADD CONSTRAINT "marketing_videos_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
