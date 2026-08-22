-- CreateTable
CREATE TABLE "EmployeeLeaveBalance" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "leaveTypeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL DEFAULT 2026,
    "allocatedDays" DOUBLE PRECISION NOT NULL DEFAULT 12.0,
    "usedDays" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "remainingDays" DOUBLE PRECISION NOT NULL DEFAULT 12.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeLeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveAdjustmentHistory" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "leaveTypeId" INTEGER NOT NULL,
    "balanceId" INTEGER,
    "previousBalance" DOUBLE PRECISION NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "adjustmentAmount" DOUBLE PRECISION NOT NULL,
    "newBalance" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "adjustedById" INTEGER,
    "adjustedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAdjustmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePolicy" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "officeId" INTEGER,
    "name" TEXT NOT NULL DEFAULT 'Standard Attendance Policy',
    "workingDaysPerWeek" INTEGER NOT NULL DEFAULT 5,
    "workingHoursPerDay" DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 15,
    "lateArrivalThresholdMins" INTEGER NOT NULL DEFAULT 30,
    "earlyCheckoutThresholdMins" INTEGER NOT NULL DEFAULT 30,
    "fullDayAbsenceDeductionPct" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "halfDayDeductionPct" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "lateArrivalDeductionPct" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
    "earlyCheckoutDeductionPct" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
    "minWorkingHoursForHalfDay" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    "overtimeEligible" BOOLEAN NOT NULL DEFAULT true,
    "breakAllowed" BOOLEAN NOT NULL DEFAULT true,
    "maxBreakDurationMins" INTEGER NOT NULL DEFAULT 60,
    "maxBreaksPerDay" INTEGER NOT NULL DEFAULT 2,
    "officeAttendanceRequired" BOOLEAN NOT NULL DEFAULT true,
    "gpsRequired" BOOLEAN NOT NULL DEFAULT true,
    "allowOutsideCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "allowOutsideCheckOut" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavePolicy" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "officeId" INTEGER,
    "name" TEXT NOT NULL DEFAULT 'Standard Leave Policy',
    "allowHalfDay" BOOLEAN NOT NULL DEFAULT true,
    "allowBackdatedLeave" BOOLEAN NOT NULL DEFAULT false,
    "maxBackdatedDays" INTEGER NOT NULL DEFAULT 3,
    "allowFutureLeave" BOOLEAN NOT NULL DEFAULT true,
    "maxFutureDays" INTEGER NOT NULL DEFAULT 90,
    "allowProbationLeave" BOOLEAN NOT NULL DEFAULT false,
    "includeHolidaysInLeave" BOOLEAN NOT NULL DEFAULT false,
    "includeWeekendsInLeave" BOOLEAN NOT NULL DEFAULT false,
    "minNoticePeriodDays" INTEGER NOT NULL DEFAULT 2,
    "maxConsecutiveDays" INTEGER NOT NULL DEFAULT 10,
    "requiresManagerApproval" BOOLEAN NOT NULL DEFAULT true,
    "requiresHrApproval" BOOLEAN NOT NULL DEFAULT true,
    "requiresAttachmentAboveDays" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryPolicy" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "officeId" INTEGER,
    "name" TEXT NOT NULL DEFAULT 'Standard Salary Policy',
    "salaryCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "payrollCycleStartDay" INTEGER NOT NULL DEFAULT 1,
    "workingDaysPerMonth" INTEGER NOT NULL DEFAULT 30,
    "fullDayDeductionPct" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "halfDayDeductionPct" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "lateArrivalDeductionPct" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
    "earlyCheckoutDeductionPct" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
    "overtimeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "overtimeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "overtimeCalculationMethod" TEXT NOT NULL DEFAULT 'HOURLY_BASE',
    "commissionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "commissionType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "commissionPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "pfPercent" DOUBLE PRECISION NOT NULL DEFAULT 12.0,
    "esiPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimPolicy" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "officeId" INTEGER,
    "name" TEXT NOT NULL DEFAULT 'Standard Claim Policy',
    "claimsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxClaimAmountPerReceipt" DOUBLE PRECISION NOT NULL DEFAULT 25000.0,
    "monthlyClaimLimit" DOUBLE PRECISION NOT NULL DEFAULT 100000.0,
    "annualClaimLimit" DOUBLE PRECISION NOT NULL DEFAULT 500000.0,
    "receiptRequired" BOOLEAN NOT NULL DEFAULT true,
    "receiptRequiredAboveAmount" DOUBLE PRECISION NOT NULL DEFAULT 500.0,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
    "autoApprovalThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "allowedCategories" TEXT[] DEFAULT ARRAY['TRAVEL', 'FOOD', 'FUEL', 'ACCOMMODATION', 'MEDICAL', 'COMMUNICATION', 'OFFICE_SUPPLIES', 'OTHER']::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLeaveBalance_employeeId_leaveTypeId_year_key" ON "EmployeeLeaveBalance"("employeeId", "leaveTypeId", "year");
CREATE INDEX "EmployeeLeaveBalance_customerId_idx" ON "EmployeeLeaveBalance"("customerId");
CREATE INDEX "EmployeeLeaveBalance_employeeId_idx" ON "EmployeeLeaveBalance"("employeeId");
CREATE INDEX "EmployeeLeaveBalance_leaveTypeId_idx" ON "EmployeeLeaveBalance"("leaveTypeId");

-- CreateIndex
CREATE INDEX "LeaveAdjustmentHistory_customerId_idx" ON "LeaveAdjustmentHistory"("customerId");
CREATE INDEX "LeaveAdjustmentHistory_employeeId_idx" ON "LeaveAdjustmentHistory"("employeeId");
CREATE INDEX "LeaveAdjustmentHistory_leaveTypeId_idx" ON "LeaveAdjustmentHistory"("leaveTypeId");
CREATE INDEX "LeaveAdjustmentHistory_createdAt_idx" ON "LeaveAdjustmentHistory"("createdAt");

-- CreateIndex
CREATE INDEX "AttendancePolicy_customerId_idx" ON "AttendancePolicy"("customerId");
CREATE INDEX "AttendancePolicy_officeId_idx" ON "AttendancePolicy"("officeId");
CREATE INDEX "AttendancePolicy_isActive_idx" ON "AttendancePolicy"("isActive");

-- CreateIndex
CREATE INDEX "LeavePolicy_customerId_idx" ON "LeavePolicy"("customerId");
CREATE INDEX "LeavePolicy_officeId_idx" ON "LeavePolicy"("officeId");
CREATE INDEX "LeavePolicy_isActive_idx" ON "LeavePolicy"("isActive");

-- CreateIndex
CREATE INDEX "SalaryPolicy_customerId_idx" ON "SalaryPolicy"("customerId");
CREATE INDEX "SalaryPolicy_officeId_idx" ON "SalaryPolicy"("officeId");
CREATE INDEX "SalaryPolicy_isActive_idx" ON "SalaryPolicy"("isActive");

-- CreateIndex
CREATE INDEX "ClaimPolicy_customerId_idx" ON "ClaimPolicy"("customerId");
CREATE INDEX "ClaimPolicy_officeId_idx" ON "ClaimPolicy"("officeId");
CREATE INDEX "ClaimPolicy_isActive_idx" ON "ClaimPolicy"("isActive");

-- AddForeignKey
ALTER TABLE "EmployeeLeaveBalance" ADD CONSTRAINT "EmployeeLeaveBalance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeLeaveBalance" ADD CONSTRAINT "EmployeeLeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeLeaveBalance" ADD CONSTRAINT "EmployeeLeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustmentHistory" ADD CONSTRAINT "LeaveAdjustmentHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveAdjustmentHistory" ADD CONSTRAINT "LeaveAdjustmentHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveAdjustmentHistory" ADD CONSTRAINT "LeaveAdjustmentHistory_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveAdjustmentHistory" ADD CONSTRAINT "LeaveAdjustmentHistory_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "EmployeeLeaveBalance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePolicy" ADD CONSTRAINT "AttendancePolicy_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendancePolicy" ADD CONSTRAINT "AttendancePolicy_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "BranchGeofence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicy" ADD CONSTRAINT "LeavePolicy_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeavePolicy" ADD CONSTRAINT "LeavePolicy_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "BranchGeofence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPolicy" ADD CONSTRAINT "SalaryPolicy_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalaryPolicy" ADD CONSTRAINT "SalaryPolicy_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "BranchGeofence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimPolicy" ADD CONSTRAINT "ClaimPolicy_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimPolicy" ADD CONSTRAINT "ClaimPolicy_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "BranchGeofence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
