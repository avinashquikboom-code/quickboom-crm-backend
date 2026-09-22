-- CreateTable
CREATE TABLE IF NOT EXISTS "meta_templates" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "name" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "key" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en_US',
    "category" TEXT NOT NULL DEFAULT 'UTILITY',
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "metaTemplateId" TEXT,
    "headerType" TEXT DEFAULT 'NONE',
    "headerContent" TEXT,
    "body" TEXT NOT NULL,
    "footer" TEXT,
    "buttons" JSONB,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rejectionReason" TEXT,
    "isLocalActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meta_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "meta_templates_templateName_idx" ON "meta_templates"("templateName");
CREATE INDEX IF NOT EXISTS "meta_templates_key_idx" ON "meta_templates"("key");
CREATE INDEX IF NOT EXISTS "meta_templates_customerId_idx" ON "meta_templates"("customerId");
CREATE INDEX IF NOT EXISTS "meta_templates_status_idx" ON "meta_templates"("status");
CREATE INDEX IF NOT EXISTS "meta_templates_isLocalActive_idx" ON "meta_templates"("isLocalActive");
CREATE INDEX IF NOT EXISTS "meta_templates_deletedAt_idx" ON "meta_templates"("deletedAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'meta_templates_customerId_fkey'
  ) THEN
    ALTER TABLE "meta_templates" ADD CONSTRAINT "meta_templates_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
