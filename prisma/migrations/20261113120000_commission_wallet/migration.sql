CREATE TABLE IF NOT EXISTS "commission_slabs" (
  "id" SERIAL NOT NULL,
  "customerId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "minAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxAmount" DOUBLE PRECISION,
  "ratePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "roles" JSONB,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_slabs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "commission_slabs_customerId_isActive_idx" ON "commission_slabs"("customerId", "isActive");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionWithdrawalStatus') THEN
    CREATE TYPE "CommissionWithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "commission_withdrawals" (
  "id" SERIAL NOT NULL,
  "customerId" INTEGER NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "method" TEXT NOT NULL,
  "accountLabel" TEXT,
  "accountRef" TEXT,
  "status" "CommissionWithdrawalStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT,
  "paymentReference" TEXT,
  "remarks" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "decidedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_withdrawals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "commission_withdrawals_idempotencyKey_key" ON "commission_withdrawals"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "commission_withdrawals_customerId_employeeId_status_idx" ON "commission_withdrawals"("customerId", "employeeId", "status");
CREATE INDEX IF NOT EXISTS "commission_withdrawals_customerId_status_idx" ON "commission_withdrawals"("customerId", "status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'commission_slabs_customerId_fkey') THEN
    ALTER TABLE "commission_slabs" ADD CONSTRAINT "commission_slabs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'commission_withdrawals_customerId_fkey') THEN
    ALTER TABLE "commission_withdrawals" ADD CONSTRAINT "commission_withdrawals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'commission_withdrawals_employeeId_fkey') THEN
    ALTER TABLE "commission_withdrawals" ADD CONSTRAINT "commission_withdrawals_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
