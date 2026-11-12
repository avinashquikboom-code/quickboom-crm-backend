-- Lead plan preference fields
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "planPreferenceType" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "customerRequirements" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "planPreferenceReady" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "activePlanProposalType" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "planProposalWorkflowAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "lead_plan_proposals" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "leadId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "proposalType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "planId" INTEGER,
    "planName" TEXT,
    "planPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "customerRequirements" TEXT,
    "customConfig" JSONB,
    "discount" DOUBLE PRECISION DEFAULT 0,
    "validUntil" TIMESTAMP(3),
    "terms" TEXT,
    "documentUrl" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "emailMessageId" TEXT,
    "emailError" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "whatsappStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "whatsappMessageId" TEXT,
    "whatsappError" TEXT,
    "whatsappSentAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_plan_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_plan_proposals_idempotencyKey_key" ON "lead_plan_proposals"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "lead_plan_proposals_leadId_version_key" ON "lead_plan_proposals"("leadId", "version");
CREATE INDEX IF NOT EXISTS "lead_plan_proposals_customerId_leadId_idx" ON "lead_plan_proposals"("customerId", "leadId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_plan_proposals_customerId_fkey') THEN
    ALTER TABLE "lead_plan_proposals" ADD CONSTRAINT "lead_plan_proposals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_plan_proposals_leadId_fkey') THEN
    ALTER TABLE "lead_plan_proposals" ADD CONSTRAINT "lead_plan_proposals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_plan_proposals_planId_fkey') THEN
    ALTER TABLE "lead_plan_proposals" ADD CONSTRAINT "lead_plan_proposals_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_plan_proposals_createdById_fkey') THEN
    ALTER TABLE "lead_plan_proposals" ADD CONSTRAINT "lead_plan_proposals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
