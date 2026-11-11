-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "history" JSONB,
ADD COLUMN     "leaderId" INTEGER,
ADD COLUMN     "qualifyingAt" TIMESTAMP(3),
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "sourceKey" TEXT,
ADD COLUMN     "teamId" INTEGER,
ADD COLUMN     "tenantId" INTEGER,
ALTER COLUMN "employeeId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "commission_shares" (
    "id" SERIAL NOT NULL,
    "commissionId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "effectiveRate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'APPROVED',
    "paidAt" TIMESTAMP(3),
    "payrollItemId" INTEGER,

    CONSTRAINT "commission_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_shares_employeeId_status_idx" ON "commission_shares"("employeeId", "status");

-- CreateIndex
CREATE INDEX "commission_shares_payrollItemId_idx" ON "commission_shares"("payrollItemId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_shares_commissionId_recipientRole_key" ON "commission_shares"("commissionId", "recipientRole");

-- CreateIndex
CREATE UNIQUE INDEX "commission_shares_commissionId_employeeId_key" ON "commission_shares"("commissionId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_sourceKey_key" ON "commissions"("sourceKey");

-- CreateIndex
CREATE INDEX "commissions_tenantId_qualifyingAt_idx" ON "commissions"("tenantId", "qualifyingAt");

-- AddForeignKey
ALTER TABLE "commission_shares" ADD CONSTRAINT "commission_shares_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_shares" ADD CONSTRAINT "commission_shares_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_shares" ADD CONSTRAINT "commission_shares_payrollItemId_fkey" FOREIGN KEY ("payrollItemId") REFERENCES "PayrollItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

