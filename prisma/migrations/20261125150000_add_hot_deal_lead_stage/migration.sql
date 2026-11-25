-- Add the stable Hot Deal stage to workspaces that already have a pipeline.
-- Existing stages (including disabled or deleted stages) are never modified.
INSERT INTO "lead_stages" ("customerId", "name", "key", "color", "bgColor", "borderColor", "sortOrder", "isActive", "isSystem", "createdAt", "updatedAt")
SELECT DISTINCT s."customerId", 'Hot Deal', 'HOT_DEAL', '#EA580C', '#FFF7ED', '#FED7AA', 10, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "lead_stages" s
WHERE s."customerId" IS NOT NULL AND s."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "lead_stages" existing
    WHERE existing."customerId" = s."customerId" AND existing."key" = 'HOT_DEAL'
  )
ON CONFLICT ("customerId", "key") DO NOTHING;
