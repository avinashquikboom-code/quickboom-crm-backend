-- AlterTable
ALTER TABLE "trending_contents" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "trending_contents" ADD COLUMN IF NOT EXISTS "views" INTEGER DEFAULT 0;
ALTER TABLE "trending_contents" ADD COLUMN IF NOT EXISTS "likes" INTEGER DEFAULT 0;
ALTER TABLE "trending_contents" ADD COLUMN IF NOT EXISTS "shares" INTEGER DEFAULT 0;
ALTER TABLE "trending_contents" ADD COLUMN IF NOT EXISTS "comments" INTEGER DEFAULT 0;
ALTER TABLE "trending_contents" ADD COLUMN IF NOT EXISTS "duration" TEXT;
ALTER TABLE "trending_contents" ADD COLUMN IF NOT EXISTS "engagementRate" DOUBLE PRECISION DEFAULT 0.0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "trending_contents_isFeatured_idx" ON "trending_contents"("isFeatured");
