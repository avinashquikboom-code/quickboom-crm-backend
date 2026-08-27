-- CreateEnum
CREATE TYPE "TrendingCategory" AS ENUM ('REEL', 'STORY', 'OFFER', 'HIGH_ROI_AD');

-- CreateTable
CREATE TABLE "trending_contents" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "TrendingCategory" NOT NULL,
    "thumbnailUrl" TEXT,
    "mediaUrl" TEXT,
    "ctaText" TEXT,
    "ctaUrl" TEXT,
    "platform" TEXT DEFAULT 'INSTAGRAM',
    "objective" TEXT DEFAULT 'ENGAGEMENT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdBy" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "trending_contents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trending_contents_customerId_isActive_isPublished_idx" ON "trending_contents"("customerId", "isActive", "isPublished");

-- CreateIndex
CREATE INDEX "trending_contents_category_idx" ON "trending_contents"("category");

-- CreateIndex
CREATE INDEX "trending_contents_priority_idx" ON "trending_contents"("priority");

-- CreateIndex
CREATE INDEX "trending_contents_deletedAt_idx" ON "trending_contents"("deletedAt");

-- AddForeignKey
ALTER TABLE "trending_contents" ADD CONSTRAINT "trending_contents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trending_contents" ADD CONSTRAINT "trending_contents_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
