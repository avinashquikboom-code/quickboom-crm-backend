ALTER TYPE "OvertimeApprovalStatus" ADD VALUE IF NOT EXISTS 'CANCELLATION_REQUESTED';

ALTER TABLE "OvertimeRequest"
  ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationRemarks" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellationDecision" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationDecisionNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationDecidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellationDecidedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "cancellationDecidedByName" TEXT;
