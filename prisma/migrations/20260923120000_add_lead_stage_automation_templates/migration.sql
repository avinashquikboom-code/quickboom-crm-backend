-- AlterTable
ALTER TABLE "lead_stages" 
ADD COLUMN IF NOT EXISTS "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "emailTemplateId" INTEGER,
ADD COLUMN IF NOT EXISTS "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "whatsappTemplateId" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_stages_emailTemplateId_idx" ON "lead_stages"("emailTemplateId");
CREATE INDEX IF NOT EXISTS "lead_stages_whatsappTemplateId_idx" ON "lead_stages"("whatsappTemplateId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_stages_emailTemplateId_fkey'
  ) THEN
    ALTER TABLE "lead_stages" ADD CONSTRAINT "lead_stages_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'lead_stages_whatsappTemplateId_fkey'
  ) THEN
    ALTER TABLE "lead_stages" ADD CONSTRAINT "lead_stages_whatsappTemplateId_fkey" FOREIGN KEY ("whatsappTemplateId") REFERENCES "meta_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
