-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_social_profiles" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_social_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lead_social_profiles_leadId_platform_key" ON "lead_social_profiles"("leadId", "platform");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_social_profiles_leadId_idx" ON "lead_social_profiles"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_social_profiles_platform_idx" ON "lead_social_profiles"("platform");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_social_profiles_leadId_fkey'
  ) THEN
    ALTER TABLE "lead_social_profiles" ADD CONSTRAINT "lead_social_profiles_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
