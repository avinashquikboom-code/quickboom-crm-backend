-- CreateTable
CREATE TABLE "marketing_banners" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "mobileImageUrl" TEXT,
    "ctaText" TEXT,
    "ctaUrl" TEXT,
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

    CONSTRAINT "marketing_banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_banners_customerId_isActive_isPublished_idx" ON "marketing_banners"("customerId", "isActive", "isPublished");

-- CreateIndex
CREATE INDEX "marketing_banners_priority_idx" ON "marketing_banners"("priority");

-- CreateIndex
CREATE INDEX "marketing_banners_startAt_endAt_idx" ON "marketing_banners"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "marketing_banners_deletedAt_idx" ON "marketing_banners"("deletedAt");

-- AddForeignKey
ALTER TABLE "marketing_banners" ADD CONSTRAINT "marketing_banners_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_banners" ADD CONSTRAINT "marketing_banners_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
