-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_stages" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0284C7',
    "bgColor" TEXT DEFAULT '#E0F2FE',
    "borderColor" TEXT DEFAULT '#BAE6FD',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lead_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lead_stages_customerId_key_key" ON "lead_stages"("customerId", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_stages_customerId_idx" ON "lead_stages"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_stages_sortOrder_idx" ON "lead_stages"("sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_stages_deletedAt_idx" ON "lead_stages"("deletedAt");

-- AddForeignKey to Customer
DO $$ BEGIN
    ALTER TABLE "lead_stages" ADD CONSTRAINT "lead_stages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable Lead: Add stageId
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "stageId" INTEGER;

-- CreateIndex for Lead stageId
CREATE INDEX IF NOT EXISTS "Lead_stageId_idx" ON "Lead"("stageId");

-- AddForeignKey from Lead to lead_stages
DO $$ BEGIN
    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "lead_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Seed standard system stages if table is empty
INSERT INTO "lead_stages" ("name", "key", "color", "bgColor", "borderColor", "sortOrder", "isActive", "isSystem", "updatedAt")
VALUES
  ('New', 'NEW', '#0284C7', '#E0F2FE', '#BAE6FD', 0, true, true, CURRENT_TIMESTAMP),
  ('Contacted', 'CONTACTED', '#D97706', '#FEF3C7', '#FDE68A', 1, true, true, CURRENT_TIMESTAMP),
  ('Follow-up', 'FOLLOW_UP', '#D97706', '#FEF3C7', '#FDE68A', 2, true, true, CURRENT_TIMESTAMP),
  ('Visit Scheduled', 'VISIT', '#8B5CF6', '#F3E8FF', '#E9D5FF', 3, true, true, CURRENT_TIMESTAMP),
  ('Qualified', 'QUALIFIED', '#4F46E5', '#EEF2FF', '#E0E7FF', 4, true, true, CURRENT_TIMESTAMP),
  ('Proposal', 'PROPOSAL', '#06B6D4', '#CFFAFE', '#A5F3FC', 5, true, true, CURRENT_TIMESTAMP),
  ('Proposal Sent', 'PROPOSAL_SENT', '#06B6D4', '#CFFAFE', '#A5F3FC', 6, true, true, CURRENT_TIMESTAMP),
  ('Negotiation', 'NEGOTIATION', '#EA580C', '#FFEDD5', '#FED7AA', 7, true, true, CURRENT_TIMESTAMP),
  ('Final Call', 'FINAL_CALL', '#EA580C', '#FFEDD5', '#FED7AA', 8, true, true, CURRENT_TIMESTAMP),
  ('Payment Pending', 'PAYMENT', '#2563EB', '#DBEAFE', '#BFDBFE', 9, true, true, CURRENT_TIMESTAMP),
  ('Work Started', 'WORK_STARTED', '#16A34A', '#DCFCE7', '#BBF7D0', 10, true, true, CURRENT_TIMESTAMP),
  ('Won', 'WON', '#16A34A', '#DCFCE7', '#BBF7D0', 11, true, true, CURRENT_TIMESTAMP),
  ('Converted', 'CONVERTED', '#16A34A', '#DCFCE7', '#BBF7D0', 12, true, true, CURRENT_TIMESTAMP),
  ('Lost', 'LOST', '#DC2626', '#FFE4E6', '#FECDD3', 13, true, true, CURRENT_TIMESTAMP),
  ('Cancelled', 'CANCELLED', '#DC2626', '#FFE4E6', '#FECDD3', 14, true, true, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Backfill stageId for existing Lead records
UPDATE "Lead" l
SET "stageId" = s.id
FROM "lead_stages" s
WHERE l."stageId" IS NULL AND l."status"::text = s."key";
