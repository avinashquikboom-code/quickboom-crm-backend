-- Safe Non-Destructive Migration: Add leadId to customers table

-- 1. Add column if not exists
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "leadId" INTEGER;

-- 2. Create unique index if not exists
CREATE UNIQUE INDEX IF NOT EXISTS "customers_leadId_key" ON "customers"("leadId");

-- 3. Add foreign key constraint safely
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'customers_leadId_fkey'
    ) THEN
        ALTER TABLE "customers" ADD CONSTRAINT "customers_leadId_fkey"
        FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
