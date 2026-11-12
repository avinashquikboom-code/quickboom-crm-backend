ALTER TABLE "lead_stages" ADD COLUMN IF NOT EXISTS "whatsappVariableMapping" JSONB;

CREATE TABLE IF NOT EXISTS "lead_stage_whatsapp_deliveries" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "leadId" INTEGER NOT NULL,
    "userId" INTEGER,
    "previousStageId" INTEGER,
    "newStageId" INTEGER,
    "previousStage" TEXT,
    "newStage" TEXT,
    "metaTemplateId" INTEGER,
    "templateName" TEXT,
    "recipientPhone" TEXT,
    "triggerSource" TEXT NOT NULL DEFAULT 'STAGE_CHANGE',
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "metaMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "variableMapping" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lead_stage_whatsapp_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_stage_whatsapp_deliveries_idempotencyKey_key" ON "lead_stage_whatsapp_deliveries"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "lead_stage_whatsapp_deliveries_customerId_idx" ON "lead_stage_whatsapp_deliveries"("customerId");
CREATE INDEX IF NOT EXISTS "lead_stage_whatsapp_deliveries_leadId_idx" ON "lead_stage_whatsapp_deliveries"("leadId");
CREATE INDEX IF NOT EXISTS "lead_stage_whatsapp_deliveries_status_idx" ON "lead_stage_whatsapp_deliveries"("status");
CREATE INDEX IF NOT EXISTS "lead_stage_whatsapp_deliveries_metaMessageId_idx" ON "lead_stage_whatsapp_deliveries"("metaMessageId");
CREATE INDEX IF NOT EXISTS "lead_stage_whatsapp_deliveries_createdAt_idx" ON "lead_stage_whatsapp_deliveries"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_stage_whatsapp_deliveries_customerId_fkey') THEN
    ALTER TABLE "lead_stage_whatsapp_deliveries" ADD CONSTRAINT "lead_stage_whatsapp_deliveries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_stage_whatsapp_deliveries_leadId_fkey') THEN
    ALTER TABLE "lead_stage_whatsapp_deliveries" ADD CONSTRAINT "lead_stage_whatsapp_deliveries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_stage_whatsapp_deliveries_userId_fkey') THEN
    ALTER TABLE "lead_stage_whatsapp_deliveries" ADD CONSTRAINT "lead_stage_whatsapp_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
