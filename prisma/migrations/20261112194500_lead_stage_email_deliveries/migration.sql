ALTER TABLE "lead_stages" ADD COLUMN IF NOT EXISTS "emailVariableMapping" JSONB;

CREATE TABLE IF NOT EXISTS "lead_stage_email_deliveries" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "leadId" INTEGER NOT NULL,
    "userId" INTEGER,
    "previousStageId" INTEGER,
    "newStageId" INTEGER,
    "previousStage" TEXT,
    "newStage" TEXT,
    "emailTemplateId" INTEGER,
    "templateName" TEXT,
    "recipientEmail" TEXT,
    "triggerSource" TEXT NOT NULL DEFAULT 'STAGE_CHANGE',
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "variableMapping" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_stage_email_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_stage_email_deliveries_idempotencyKey_key" ON "lead_stage_email_deliveries"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "lead_stage_email_deliveries_customerId_idx" ON "lead_stage_email_deliveries"("customerId");
CREATE INDEX IF NOT EXISTS "lead_stage_email_deliveries_leadId_idx" ON "lead_stage_email_deliveries"("leadId");
CREATE INDEX IF NOT EXISTS "lead_stage_email_deliveries_status_idx" ON "lead_stage_email_deliveries"("status");
CREATE INDEX IF NOT EXISTS "lead_stage_email_deliveries_providerMessageId_idx" ON "lead_stage_email_deliveries"("providerMessageId");
CREATE INDEX IF NOT EXISTS "lead_stage_email_deliveries_createdAt_idx" ON "lead_stage_email_deliveries"("createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_stage_email_deliveries_customerId_fkey') THEN
    ALTER TABLE "lead_stage_email_deliveries" ADD CONSTRAINT "lead_stage_email_deliveries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_stage_email_deliveries_leadId_fkey') THEN
    ALTER TABLE "lead_stage_email_deliveries" ADD CONSTRAINT "lead_stage_email_deliveries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_stage_email_deliveries_userId_fkey') THEN
    ALTER TABLE "lead_stage_email_deliveries" ADD CONSTRAINT "lead_stage_email_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
