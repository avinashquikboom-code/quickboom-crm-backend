-- CreateTable
CREATE TABLE IF NOT EXISTS "ShiftAssignmentHistory" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "shiftId" INTEGER,
    "previousShiftId" INTEGER,
    "newShiftId" INTEGER,
    "changedById" INTEGER,
    "changedByName" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShiftAssignmentHistory_customerId_idx" ON "ShiftAssignmentHistory"("customerId");
CREATE INDEX IF NOT EXISTS "ShiftAssignmentHistory_employeeId_idx" ON "ShiftAssignmentHistory"("employeeId");
CREATE INDEX IF NOT EXISTS "ShiftAssignmentHistory_shiftId_idx" ON "ShiftAssignmentHistory"("shiftId");
CREATE INDEX IF NOT EXISTS "ShiftAssignmentHistory_previousShiftId_idx" ON "ShiftAssignmentHistory"("previousShiftId");
CREATE INDEX IF NOT EXISTS "ShiftAssignmentHistory_newShiftId_idx" ON "ShiftAssignmentHistory"("newShiftId");
CREATE INDEX IF NOT EXISTS "ShiftAssignmentHistory_effectiveFrom_idx" ON "ShiftAssignmentHistory"("effectiveFrom");
CREATE INDEX IF NOT EXISTS "ShiftAssignmentHistory_createdAt_idx" ON "ShiftAssignmentHistory"("createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ShiftAssignmentHistory" ADD CONSTRAINT "ShiftAssignmentHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftAssignmentHistory" ADD CONSTRAINT "ShiftAssignmentHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftAssignmentHistory" ADD CONSTRAINT "ShiftAssignmentHistory_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftAssignmentHistory" ADD CONSTRAINT "ShiftAssignmentHistory_previousShiftId_fkey" FOREIGN KEY ("previousShiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftAssignmentHistory" ADD CONSTRAINT "ShiftAssignmentHistory_newShiftId_fkey" FOREIGN KEY ("newShiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
