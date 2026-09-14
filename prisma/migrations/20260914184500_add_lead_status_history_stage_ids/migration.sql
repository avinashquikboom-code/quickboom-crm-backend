-- AlterTable LeadStatusHistory: Add fromStageId and toStageId
ALTER TABLE "LeadStatusHistory" ADD COLUMN IF NOT EXISTS "fromStageId" INTEGER;
ALTER TABLE "LeadStatusHistory" ADD COLUMN IF NOT EXISTS "toStageId" INTEGER;

-- CreateIndex for LeadStatusHistory stage IDs
CREATE INDEX IF NOT EXISTS "LeadStatusHistory_toStageId_idx" ON "LeadStatusHistory"("toStageId");
CREATE INDEX IF NOT EXISTS "LeadStatusHistory_fromStageId_idx" ON "LeadStatusHistory"("fromStageId");

-- AddForeignKey from LeadStatusHistory to lead_stages
DO $$ BEGIN
    ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "lead_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "lead_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Safely backfill toStageId from dynamic lead_stages (prefer customer-specific stage, fallback to system stage)
UPDATE "LeadStatusHistory" h
SET "toStageId" = sub.stage_id
FROM (
    SELECT DISTINCT ON (h2.id) h2.id AS history_id, s.id AS stage_id
    FROM "LeadStatusHistory" h2
    JOIN "Lead" l ON l.id = h2."leadId"
    JOIN "lead_stages" s ON s.key = h2."toStatus"::text 
        AND (s."customerId" = l."customerId" OR s."customerId" IS NULL)
        AND s."deletedAt" IS NULL
    WHERE h2."toStageId" IS NULL
    ORDER BY h2.id, s."customerId" DESC NULLS LAST
) sub
WHERE h.id = sub.history_id;

-- Safely backfill fromStageId from dynamic lead_stages (prefer customer-specific stage, fallback to system stage)
UPDATE "LeadStatusHistory" h
SET "fromStageId" = sub.stage_id
FROM (
    SELECT DISTINCT ON (h2.id) h2.id AS history_id, s.id AS stage_id
    FROM "LeadStatusHistory" h2
    JOIN "Lead" l ON l.id = h2."leadId"
    JOIN "lead_stages" s ON s.key = h2."fromStatus"::text 
        AND (s."customerId" = l."customerId" OR s."customerId" IS NULL)
        AND s."deletedAt" IS NULL
    WHERE h2."fromStatus" IS NOT NULL AND h2."fromStageId" IS NULL
    ORDER BY h2.id, s."customerId" DESC NULLS LAST
) sub
WHERE h.id = sub.history_id;
