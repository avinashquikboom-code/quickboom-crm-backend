-- Rename HOT_DEAL lead stage to HOT_LEAD while preserving all IDs and relationships.
UPDATE "LeadStage"
SET "key" = 'HOT_LEAD',
    "name" = 'Hot Lead',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'HOT_DEAL'
  AND NOT EXISTS (
    SELECT 1 FROM "LeadStage" existing
    WHERE existing."customerId" = "LeadStage"."customerId"
      AND existing."key" = 'HOT_LEAD'
  );

-- Update any email template categories referencing HOT_DEAL
UPDATE "EmailTemplate"
SET "category" = 'HOT_LEAD',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "category" = 'HOT_DEAL';
