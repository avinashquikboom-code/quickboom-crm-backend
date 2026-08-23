-- ============================================================
-- Migration: sync_task_status_indexes_defaults
-- Resolves schema drift detected between schema.prisma and
-- the accumulated prisma/migrations SQL history.
--
-- Changes:
--   1. TaskStatus enum — add SUBMITTED, UNDER_REVIEW, REJECTED values
--   2. Drop indexes removed from schema (Contact, Deal)
--   3. Create new Task_dueAt_idx index
--   4. DataCaptureJob.updatedAt — drop default (was @updatedAt only)
--   5. Shift.updatedAt — drop default
--   6. ShiftGuidance.updatedAt — drop default
--   7. Visit.visitType — set default to 'CLIENT_MEETING'
-- ============================================================

-- AlterEnum: TaskStatus — add review/submission lifecycle values
-- NOTE: PostgreSQL 12+ supports multiple ADD VALUE in one ALTER TYPE,
-- but using IF NOT EXISTS guards makes this idempotent.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- DropIndex: indexes removed from Contact and Deal models
DROP INDEX IF EXISTS "Contact_assignedToId_idx";
DROP INDEX IF EXISTS "Deal_assignedToId_idx";
DROP INDEX IF EXISTS "Deal_leadId_idx";

-- CreateIndex: Task — performance index on dueAt
CREATE INDEX IF NOT EXISTS "Task_dueAt_idx" ON "Task"("dueAt");

-- AlterTable: DataCaptureJob.updatedAt — remove default (schema has @updatedAt, no @default)
ALTER TABLE "DataCaptureJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable: Shift.updatedAt — remove default
ALTER TABLE "Shift" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable: ShiftGuidance.updatedAt — remove default
ALTER TABLE "ShiftGuidance" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable: Visit.visitType — set default value
ALTER TABLE "Visit" ALTER COLUMN "visitType" SET DEFAULT 'CLIENT_MEETING';
