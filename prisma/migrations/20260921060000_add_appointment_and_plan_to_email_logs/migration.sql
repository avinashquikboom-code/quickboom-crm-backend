-- AlterTable
ALTER TABLE "email_logs" ADD COLUMN IF NOT EXISTS "appointmentId" INTEGER;
ALTER TABLE "email_logs" ADD COLUMN IF NOT EXISTS "planId" INTEGER;
ALTER TABLE "email_logs" ADD COLUMN IF NOT EXISTS "channel" TEXT DEFAULT 'EMAIL';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_logs_appointmentId_idx" ON "email_logs"("appointmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_logs_planId_idx" ON "email_logs"("planId");
