-- Optional attribution only; existing leads remain NULL and no employee relation is added.
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "convertedByEmployeeId" INTEGER;
