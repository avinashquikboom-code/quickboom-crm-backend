-- AlterTable
ALTER TABLE "Designation" ADD COLUMN IF NOT EXISTS "crmMobileAccess" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing BPO / Telesales designations
UPDATE "Designation"
SET "crmMobileAccess" = true
WHERE UPPER("name") LIKE '%TELE%'
   OR UPPER("name") LIKE '%BPO%'
   OR UPPER("code") LIKE '%TELE%'
   OR UPPER("code") LIKE '%BPO%';
