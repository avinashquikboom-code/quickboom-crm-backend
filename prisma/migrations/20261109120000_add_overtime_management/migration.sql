-- CreateEnum
CREATE TYPE "OvertimeType" AS ENUM ('REGULAR', 'WEEKEND', 'HOLIDAY', 'NIGHT_SHIFT');

-- CreateEnum
CREATE TYPE "OvertimeApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OvertimePayrollStatus" AS ENUM ('NOT_PROCESSED', 'READY_FOR_PAYROLL', 'PROCESSED', 'PAID');

-- CreateTable
CREATE TABLE "OvertimePolicy" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxDailyMinutes" INTEGER NOT NULL DEFAULT 240,
    "maxWeeklyMinutes" INTEGER NOT NULL DEFAULT 720,
    "weekendMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "holidayMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "nightShiftMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
    "autoCalculate" BOOLEAN NOT NULL DEFAULT false,
    "applicableEmployeeTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimeRequest" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "attendanceId" INTEGER,
    "shiftId" INTEGER,
    "overtimeDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "approvedMinutes" INTEGER,
    "overtimeType" "OvertimeType" NOT NULL DEFAULT 'REGULAR',
    "reason" TEXT NOT NULL,
    "employeeNotes" TEXT,
    "managerNotes" TEXT,
    "status" "OvertimeApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" INTEGER,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" INTEGER,
    "rejectedByName" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "overtimeRate" DOUBLE PRECISION,
    "multiplier" DOUBLE PRECISION,
    "calculatedAmount" DOUBLE PRECISION,
    "payrollStatus" "OvertimePayrollStatus" NOT NULL DEFAULT 'NOT_PROCESSED',
    "payrollId" INTEGER,
    "payrollItemId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "OvertimeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimeApproval" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "overtimeRequestId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "OvertimeApprovalStatus" NOT NULL,
    "toStatus" "OvertimeApprovalStatus" NOT NULL,
    "actorId" INTEGER,
    "actorName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OvertimeApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OvertimePolicy_customerId_key" ON "OvertimePolicy"("customerId");
CREATE INDEX "OvertimePolicy_customerId_idx" ON "OvertimePolicy"("customerId");
CREATE INDEX "OvertimeRequest_customerId_idx" ON "OvertimeRequest"("customerId");
CREATE INDEX "OvertimeRequest_employeeId_idx" ON "OvertimeRequest"("employeeId");
CREATE INDEX "OvertimeRequest_attendanceId_idx" ON "OvertimeRequest"("attendanceId");
CREATE INDEX "OvertimeRequest_shiftId_idx" ON "OvertimeRequest"("shiftId");
CREATE INDEX "OvertimeRequest_overtimeDate_idx" ON "OvertimeRequest"("overtimeDate");
CREATE INDEX "OvertimeRequest_status_idx" ON "OvertimeRequest"("status");
CREATE INDEX "OvertimeRequest_payrollStatus_idx" ON "OvertimeRequest"("payrollStatus");
CREATE INDEX "OvertimeRequest_customerId_employeeId_overtimeDate_idx" ON "OvertimeRequest"("customerId", "employeeId", "overtimeDate");
CREATE INDEX "OvertimeApproval_customerId_idx" ON "OvertimeApproval"("customerId");
CREATE INDEX "OvertimeApproval_overtimeRequestId_idx" ON "OvertimeApproval"("overtimeRequestId");

-- AddForeignKey
ALTER TABLE "OvertimePolicy" ADD CONSTRAINT "OvertimePolicy_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_payrollItemId_fkey" FOREIGN KEY ("payrollItemId") REFERENCES "PayrollItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OvertimeApproval" ADD CONSTRAINT "OvertimeApproval_overtimeRequestId_fkey" FOREIGN KEY ("overtimeRequestId") REFERENCES "OvertimeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
