-- CreateTable
CREATE TABLE "social_media_handlers" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountUrl" TEXT,
    "handlerName" TEXT,
    "handlerPhone" TEXT,
    "handlerEmail" TEXT,
    "workType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "durationDays" INTEGER DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "social_media_handlers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_media_handlers_customerId_idx" ON "social_media_handlers"("customerId");

-- CreateIndex
CREATE INDEX "social_media_handlers_platform_idx" ON "social_media_handlers"("platform");

-- CreateIndex
CREATE INDEX "social_media_handlers_status_idx" ON "social_media_handlers"("status");

-- CreateIndex
CREATE INDEX "social_media_handlers_deletedAt_idx" ON "social_media_handlers"("deletedAt");

-- AddForeignKey
ALTER TABLE "social_media_handlers" ADD CONSTRAINT "social_media_handlers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
