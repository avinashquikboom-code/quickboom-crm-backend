-- CreateTable
CREATE TABLE "integration_settings" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "environment" TEXT NOT NULL DEFAULT 'LIVE',
    "credentials" JSONB NOT NULL,
    "config" JSONB,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "integration_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_settings_provider_key" ON "integration_settings"("provider");

-- CreateIndex
CREATE INDEX "integration_settings_provider_isEnabled_idx" ON "integration_settings"("provider", "isEnabled");

-- CreateIndex
CREATE INDEX "integration_settings_deletedAt_idx" ON "integration_settings"("deletedAt");
