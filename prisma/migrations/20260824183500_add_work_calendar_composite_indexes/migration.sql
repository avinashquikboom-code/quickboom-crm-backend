-- CreateIndex
CREATE INDEX IF NOT EXISTS "Work_customerId_scheduledDate_idx" ON "Work"("customerId", "scheduledDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Work_customerId_status_idx" ON "Work"("customerId", "status");
