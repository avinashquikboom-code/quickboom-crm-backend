-- AlterTable
ALTER TABLE "marketing_videos" ADD COLUMN "showOnHome" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "marketing_videos" ADD COLUMN "showInIntroduction" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "marketing_videos_showOnHome_idx" ON "marketing_videos"("showOnHome");
CREATE INDEX "marketing_videos_showInIntroduction_idx" ON "marketing_videos"("showInIntroduction");

-- CreateTable
CREATE TABLE "customer_marketing_video_views" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "marketingVideoId" INTEGER NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_marketing_video_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_marketing_video_views_customerId_marketingVideoId_key" ON "customer_marketing_video_views"("customerId", "marketingVideoId");
CREATE INDEX "customer_marketing_video_views_customerId_idx" ON "customer_marketing_video_views"("customerId");
CREATE INDEX "customer_marketing_video_views_marketingVideoId_idx" ON "customer_marketing_video_views"("marketingVideoId");

-- AddForeignKey
ALTER TABLE "customer_marketing_video_views" ADD CONSTRAINT "customer_marketing_video_views_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_marketing_video_views" ADD CONSTRAINT "customer_marketing_video_views_marketingVideoId_fkey" FOREIGN KEY ("marketingVideoId") REFERENCES "marketing_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
