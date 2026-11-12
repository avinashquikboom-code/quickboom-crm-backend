-- AlterTable: meta_templates.source
ALTER TABLE "meta_templates" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'META_SYNC';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "meta_templates_source_idx" ON "meta_templates"("source");

-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_campaigns" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metaTemplateId" INTEGER NOT NULL,
    "variableMapping" JSONB,
    "audienceType" TEXT NOT NULL DEFAULT 'LEAD_FILTER',
    "audienceFilter" JSONB,
    "manualRecipients" JSONB,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_campaign_recipients" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "leadId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "whatsapp_campaigns_customerId_idx" ON "whatsapp_campaigns"("customerId");
CREATE INDEX IF NOT EXISTS "whatsapp_campaigns_status_idx" ON "whatsapp_campaigns"("status");
CREATE INDEX IF NOT EXISTS "whatsapp_campaigns_scheduledAt_idx" ON "whatsapp_campaigns"("scheduledAt");
CREATE INDEX IF NOT EXISTS "whatsapp_campaigns_metaTemplateId_idx" ON "whatsapp_campaigns"("metaTemplateId");

CREATE INDEX IF NOT EXISTS "whatsapp_campaign_recipients_campaignId_idx" ON "whatsapp_campaign_recipients"("campaignId");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_recipients_status_idx" ON "whatsapp_campaign_recipients"("status");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_recipients_phone_idx" ON "whatsapp_campaign_recipients"("phone");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'whatsapp_campaigns_customerId_fkey'
  ) THEN
    ALTER TABLE "whatsapp_campaigns" ADD CONSTRAINT "whatsapp_campaigns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'whatsapp_campaigns_metaTemplateId_fkey'
  ) THEN
    ALTER TABLE "whatsapp_campaigns" ADD CONSTRAINT "whatsapp_campaigns_metaTemplateId_fkey" FOREIGN KEY ("metaTemplateId") REFERENCES "meta_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'whatsapp_campaign_recipients_campaignId_fkey'
  ) THEN
    ALTER TABLE "whatsapp_campaign_recipients" ADD CONSTRAINT "whatsapp_campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "whatsapp_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
