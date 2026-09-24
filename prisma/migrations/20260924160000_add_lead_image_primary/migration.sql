-- AlterTable
ALTER TABLE "lead_images" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "lead_images_leadId_isPrimary_idx" ON "lead_images"("leadId", "isPrimary");
