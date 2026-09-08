-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "assignedTeamId" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customers_assignedTeamId_idx" ON "customers"("assignedTeamId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_assignedTeamId_fkey'
  ) THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
