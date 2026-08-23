-- AlterTable Company: Add assignment, geo, and metadata fields if not exists
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "assignedToId" INTEGER;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "googlePlaceId" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "rating" DOUBLE PRECISION;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "reviewCount" INTEGER;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'MANUAL';
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'ACTIVE';
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "website" TEXT;

-- AlterTable Contact: Add assignment, mobile, and communication fields if not exists
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "alternateMobile" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "assignedToId" INTEGER;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "mobile" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'DIRECT';
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'ACTIVE';
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "website" TEXT;

-- AlterTable Deal: Add assignment, currency, description, and source fields if not exists
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "assignedToId" INTEGER;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "currency" TEXT DEFAULT 'INR';
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "leadId" INTEGER;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'CRM';

-- CreateIndexes for Company
CREATE INDEX IF NOT EXISTS "Company_googlePlaceId_idx" ON "Company"("googlePlaceId");
CREATE INDEX IF NOT EXISTS "Company_assignedToId_idx" ON "Company"("assignedToId");

-- CreateIndexes for Contact
CREATE INDEX IF NOT EXISTS "Contact_assignedToId_idx" ON "Contact"("assignedToId");

-- CreateIndexes for Deal
CREATE INDEX IF NOT EXISTS "Deal_assignedToId_idx" ON "Deal"("assignedToId");
CREATE INDEX IF NOT EXISTS "Deal_leadId_idx" ON "Deal"("leadId");

-- AddForeignKeys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Company_assignedToId_fkey'
    ) THEN
        ALTER TABLE "Company" ADD CONSTRAINT "Company_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Contact_assignedToId_fkey'
    ) THEN
        ALTER TABLE "Contact" ADD CONSTRAINT "Contact_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Deal_assignedToId_fkey'
    ) THEN
        ALTER TABLE "Deal" ADD CONSTRAINT "Deal_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
