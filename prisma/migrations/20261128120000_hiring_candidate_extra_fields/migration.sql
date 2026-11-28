-- Hiring public form: address, applied role, referrer and portfolio link (additive, nullable)
ALTER TABLE "candidate_applications"
  ADD COLUMN IF NOT EXISTS "candidateAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "appliedRole" TEXT,
  ADD COLUMN IF NOT EXISTS "referredBy" TEXT,
  ADD COLUMN IF NOT EXISTS "workLink" TEXT;
