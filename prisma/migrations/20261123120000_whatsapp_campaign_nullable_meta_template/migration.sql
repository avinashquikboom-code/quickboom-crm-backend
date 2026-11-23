-- AlterTable
ALTER TABLE "whatsapp_campaigns" ALTER COLUMN "metaTemplateId" DROP NOT NULL;

-- DropForeignKey
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'whatsapp_campaigns_metaTemplateId_fkey'
    ) THEN
        ALTER TABLE "whatsapp_campaigns" DROP CONSTRAINT "whatsapp_campaigns_metaTemplateId_fkey";
    END IF;
END $$;

-- AddForeignKey
ALTER TABLE "whatsapp_campaigns" ADD CONSTRAINT "whatsapp_campaigns_metaTemplateId_fkey" FOREIGN KEY ("metaTemplateId") REFERENCES "meta_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
