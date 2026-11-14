-- CreateEnum
CREATE TYPE "DeductionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'REVERSED');

-- AlterTable
ALTER TABLE "PayrollItem" ADD COLUMN "penaltyDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EmployeeDeduction" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "payrollMonth" INTEGER NOT NULL,
    "payrollYear" INTEGER NOT NULL,
    "status" "DeductionStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" INTEGER,
    "createdByName" TEXT,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" INTEGER,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "payrollItemId" INTEGER,
    "appliedAt" TIMESTAMP(3),
    "reversedById" INTEGER,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeDeduction_customerId_idx" ON "EmployeeDeduction"("customerId");

-- CreateIndex
CREATE INDEX "EmployeeDeduction_employeeId_idx" ON "EmployeeDeduction"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDeduction_payrollItemId_idx" ON "EmployeeDeduction"("payrollItemId");

-- CreateIndex
CREATE INDEX "EmployeeDeduction_customerId_status_payrollMonth_payrollYear_idx" ON "EmployeeDeduction"("customerId", "status", "payrollMonth", "payrollYear");

-- AddForeignKey
ALTER TABLE "EmployeeDeduction" ADD CONSTRAINT "EmployeeDeduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDeduction" ADD CONSTRAINT "EmployeeDeduction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDeduction" ADD CONSTRAINT "EmployeeDeduction_payrollItemId_fkey" FOREIGN KEY ("payrollItemId") REFERENCES "PayrollItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
