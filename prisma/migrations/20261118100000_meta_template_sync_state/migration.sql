ALTER TABLE "meta_templates"
  ADD COLUMN "lastSyncAttemptAt" TIMESTAMP(3),
  ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'NOT_SYNCED',
  ADD COLUMN "syncError" TEXT,
  ADD COLUMN "syncedWabaId" TEXT;

UPDATE "meta_templates"
SET "syncStatus" = CASE
  WHEN "metaTemplateId" IS NOT NULL AND "metaTemplateId" NOT LIKE 'seed\_%' THEN 'SYNCED'
  ELSE 'NOT_SYNCED'
END;
