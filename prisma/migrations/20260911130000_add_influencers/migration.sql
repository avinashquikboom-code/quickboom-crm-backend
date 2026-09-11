-- CreateTable
CREATE TABLE IF NOT EXISTS "influencer_categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "influencer_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "influencers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT,
    "avatarUrl" TEXT,
    "profileImage" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'INSTAGRAM',
    "categoryId" INTEGER,
    "categoryName" TEXT,
    "location" TEXT DEFAULT 'India',
    "city" TEXT,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "followersCount" TEXT DEFAULT '0',
    "engagementRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bio" TEXT,
    "bookingUrl" TEXT,
    "pricing" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION DEFAULT 4.9,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "influencers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "influencer_categories_name_key" ON "influencer_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "influencer_categories_slug_key" ON "influencer_categories"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "influencer_categories_isActive_idx" ON "influencer_categories"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "influencer_categories_sortOrder_idx" ON "influencer_categories"("sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "influencers_isActive_isFeatured_idx" ON "influencers"("isActive", "isFeatured");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "influencers_categoryId_idx" ON "influencers"("categoryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "influencers_platform_idx" ON "influencers"("platform");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "influencers_sortOrder_idx" ON "influencers"("sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "influencers_deletedAt_idx" ON "influencers"("deletedAt");

-- AddForeignKey
ALTER TABLE "influencers" DROP CONSTRAINT IF EXISTS "influencers_categoryId_fkey";
ALTER TABLE "influencers" ADD CONSTRAINT "influencers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "influencer_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
