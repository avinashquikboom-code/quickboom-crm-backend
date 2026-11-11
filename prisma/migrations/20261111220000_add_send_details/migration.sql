-- CreateTable
CREATE TABLE IF NOT EXISTS "send_details_documents" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "fileType" TEXT DEFAULT 'application/pdf',
    "version" TEXT DEFAULT '1.0',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "send_details_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "send_details_configs" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "triggerStageKey" TEXT NOT NULL DEFAULT 'DETAILS_SENT',
    "isAutomationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappTemplateName" TEXT DEFAULT 'lead_stage_details_sent',
    "emailSubject" TEXT DEFAULT 'Company Details & Information',
    "emailBody" TEXT,
    "activeCategories" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_details_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "send_details_configs_customerId_key" ON "send_details_configs"("customerId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "send_details_deliveries" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "leadId" INTEGER NOT NULL,
    "userId" INTEGER,
    "previousStage" TEXT,
    "newStage" TEXT,
    "triggerType" TEXT NOT NULL DEFAULT 'AUTOMATIC',
    "idempotencyKey" TEXT,
    "channels" JSONB,
    "documentIds" JSONB,
    "documentsSummary" JSONB,
    "recipientPhone" TEXT,
    "recipientEmail" TEXT,
    "whatsappStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "whatsappMessageId" TEXT,
    "whatsappError" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "emailMessageId" TEXT,
    "emailError" TEXT,
    "overallStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_details_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "send_details_deliveries_idempotencyKey_key" ON "send_details_deliveries"("idempotencyKey");

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "send_details_documents_customerId_idx" ON "send_details_documents"("customerId");
CREATE INDEX IF NOT EXISTS "send_details_documents_category_idx" ON "send_details_documents"("category");
CREATE INDEX IF NOT EXISTS "send_details_documents_isActive_idx" ON "send_details_documents"("isActive");
CREATE INDEX IF NOT EXISTS "send_details_documents_deletedAt_idx" ON "send_details_documents"("deletedAt");

CREATE INDEX IF NOT EXISTS "send_details_configs_customerId_idx" ON "send_details_configs"("customerId");

CREATE INDEX IF NOT EXISTS "send_details_deliveries_customerId_idx" ON "send_details_deliveries"("customerId");
CREATE INDEX IF NOT EXISTS "send_details_deliveries_leadId_idx" ON "send_details_deliveries"("leadId");
CREATE INDEX IF NOT EXISTS "send_details_deliveries_overallStatus_idx" ON "send_details_deliveries"("overallStatus");
CREATE INDEX IF NOT EXISTS "send_details_deliveries_createdAt_idx" ON "send_details_deliveries"("createdAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "send_details_documents" ADD CONSTRAINT "send_details_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "send_details_configs" ADD CONSTRAINT "send_details_configs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "send_details_deliveries" ADD CONSTRAINT "send_details_deliveries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "send_details_deliveries" ADD CONSTRAINT "send_details_deliveries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "send_details_deliveries" ADD CONSTRAINT "send_details_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

