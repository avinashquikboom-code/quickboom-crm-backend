-- AlterTable
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "socialMedia" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_images" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT,
    "caption" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_images_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "lead_images" ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_images_leadId_idx" ON "lead_images"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_images_leadId_isPrimary_idx" ON "lead_images"("leadId", "isPrimary");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_images_leadId_fkey'
  ) THEN
    ALTER TABLE "lead_images" ADD CONSTRAINT "lead_images_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
