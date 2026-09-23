-- Safe Non-Destructive Migration: Add createdByEmployeeId to customers table

-- 1. Add column if not exists
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "createdByEmployeeId" INTEGER;

-- 2. Create index if not exists
CREATE INDEX IF NOT EXISTS "customers_createdByEmployeeId_idx" ON "customers"("createdByEmployeeId");

-- 3. Add foreign key constraint safely
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'customers_createdByEmployeeId_fkey'
    ) THEN
        ALTER TABLE "customers" ADD CONSTRAINT "customers_createdByEmployeeId_fkey"
        FOREIGN KEY ("createdByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
