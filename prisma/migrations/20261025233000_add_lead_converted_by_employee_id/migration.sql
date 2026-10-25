-- Optional attribution only; existing leads remain NULL and no employee relation is added.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'crm_leads') THEN
    ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "convertedByEmployeeId" INTEGER;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Lead') THEN
    ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "convertedByEmployeeId" INTEGER;
  END IF;
END $$;
