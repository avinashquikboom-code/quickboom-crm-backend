-- Daily Call Reward Slabs & Ledger
ALTER TABLE "telecaller_target_policies"
  ADD COLUMN IF NOT EXISTS "minConnectedCalls" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "maxConnectedCalls" INTEGER NOT NULL DEFAULT 70;

CREATE TABLE IF NOT EXISTS "telecaller_reward_slabs" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "minCalls" INTEGER NOT NULL,
  "maxCalls" INTEGER,
  "rewardPoints" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "telecaller_reward_slabs_idx"
  ON "telecaller_reward_slabs" ("customerId", "isActive", "sortOrder");

CREATE TABLE IF NOT EXISTS "telecaller_reward_ledgers" (
  "id" SERIAL PRIMARY KEY,
  "customerId" INTEGER NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "businessDate" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "totalCalls" INTEGER NOT NULL DEFAULT 0,
  "connectedCalls" INTEGER NOT NULL DEFAULT 0,
  "points" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'CREDITED',
  "slabId" INTEGER,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "telecaller_reward_ledgers_idx"
  ON "telecaller_reward_ledgers" ("customerId", "employeeId", "businessDate");
