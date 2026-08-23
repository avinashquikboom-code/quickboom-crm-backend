-- AlterTable Visit: Add CRM relations and follow-up fields if not exists
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "contactId" INTEGER;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "dealId" INTEGER;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "nextFollowUpDate" TIMESTAMP(3);
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "outcome" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "visitType" TEXT;

-- AlterTable Task: Add task number, due timing, and lifecycle fields if not exists
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "taskNumber" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "dueTime" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "submissionComment" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "approvedById" INTEGER;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "approvedByName" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "rejectedById" INTEGER;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "rejectedByName" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

-- CreateTable TaskReview if not exists
CREATE TABLE IF NOT EXISTS "TaskReview" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "reviewedById" INTEGER NOT NULL,
    "reviewedByName" TEXT,
    "status" TEXT NOT NULL,
    "comment" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes for Visit
CREATE INDEX IF NOT EXISTS "Visit_companyId_idx" ON "Visit"("companyId");
CREATE INDEX IF NOT EXISTS "Visit_contactId_idx" ON "Visit"("contactId");
CREATE INDEX IF NOT EXISTS "Visit_dealId_idx" ON "Visit"("dealId");

-- CreateIndexes for TaskReview
CREATE INDEX IF NOT EXISTS "TaskReview_taskId_idx" ON "TaskReview"("taskId");

-- AddForeignKeys (drop first to prevent duplicate constraint errors)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Visit_companyId_fkey'
    ) THEN
        ALTER TABLE "Visit" ADD CONSTRAINT "Visit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Visit_contactId_fkey'
    ) THEN
        ALTER TABLE "Visit" ADD CONSTRAINT "Visit_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Visit_dealId_fkey'
    ) THEN
        ALTER TABLE "Visit" ADD CONSTRAINT "Visit_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TaskReview_taskId_fkey'
    ) THEN
        ALTER TABLE "TaskReview" ADD CONSTRAINT "TaskReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
