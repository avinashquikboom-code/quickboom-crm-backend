-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "assignedEmployeeId" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customers_assignedEmployeeId_idx" ON "customers"("assignedEmployeeId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_assignedEmployeeId_fkey'
  ) THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
