-- AlterTable Company: Remove assignedToId and foreign key constraint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Company_assignedToId_fkey'
    ) THEN
        ALTER TABLE "Company" DROP CONSTRAINT "Company_assignedToId_fkey";
    END IF;
END $$;

DROP INDEX IF EXISTS "Company_assignedToId_idx";

ALTER TABLE "Company" DROP COLUMN IF EXISTS "assignedToId";
