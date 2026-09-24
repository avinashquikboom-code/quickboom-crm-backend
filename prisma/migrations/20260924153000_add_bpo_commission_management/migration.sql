-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "CommissionConfigStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "commission_configs" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "commissionType" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
    "commissionValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CommissionConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "leadId" INTEGER,
    "planId" INTEGER,
    "purchase_id" INTEGER,
    "order_id" TEXT,
    "commissionType" "CommissionType" NOT NULL,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchaseAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_configs_employeeId_key" ON "commission_configs"("employeeId");

-- CreateIndex
CREATE INDEX "commission_configs_customerId_idx" ON "commission_configs"("customerId");

-- CreateIndex
CREATE INDEX "commission_configs_employeeId_idx" ON "commission_configs"("employeeId");

-- CreateIndex
CREATE INDEX "commission_configs_status_idx" ON "commission_configs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_purchase_id_key" ON "commissions"("purchase_id");

-- CreateIndex
CREATE INDEX "commissions_customerId_idx" ON "commissions"("customerId");

-- CreateIndex
CREATE INDEX "commissions_employeeId_idx" ON "commissions"("employeeId");

-- CreateIndex
CREATE INDEX "commissions_leadId_idx" ON "commissions"("leadId");

-- CreateIndex
CREATE INDEX "commissions_planId_idx" ON "commissions"("planId");

-- CreateIndex
CREATE INDEX "commissions_purchase_id_idx" ON "commissions"("purchase_id");

-- CreateIndex
CREATE INDEX "commissions_order_id_idx" ON "commissions"("order_id");

-- CreateIndex
CREATE INDEX "commissions_status_idx" ON "commissions"("status");

-- CreateIndex
CREATE INDEX "commissions_createdAt_idx" ON "commissions"("createdAt");

-- AddForeignKey
ALTER TABLE "commission_configs" ADD CONSTRAINT "commission_configs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_configs" ADD CONSTRAINT "commission_configs_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "PaymentHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
