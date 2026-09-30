-- CreateTable
CREATE TABLE IF NOT EXISTS "NotificationCampaign" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL DEFAULT 'OFFER',
    "targetType" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "targetIds" JSONB,
    "imageUrl" TEXT,
    "showCta" BOOLEAN NOT NULL DEFAULT false,
    "ctaText" TEXT,
    "ctaActionType" TEXT,
    "ctaActionValue" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationCampaign_status_scheduledAt_idx" ON "NotificationCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationCampaign_createdAt_idx" ON "NotificationCampaign"("createdAt");
