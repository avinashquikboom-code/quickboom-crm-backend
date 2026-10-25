-- Requested removal of Won By attribution. Commission records and conversion dates remain intact.
ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_convertedByEmployeeId_fkey";
DROP INDEX IF EXISTS "Lead_convertedByEmployeeId_idx";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "convertedByEmployeeId";
