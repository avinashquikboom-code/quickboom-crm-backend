-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "accuracy" DOUBLE PRECISION,
ADD COLUMN     "isLate" BOOLEAN DEFAULT false,
ADD COLUMN     "lateMinutes" INTEGER DEFAULT 0,
ADD COLUMN     "locationStatus" TEXT DEFAULT 'INSIDE_RADIUS',
ADD COLUMN     "punchOutAccuracy" DOUBLE PRECISION,
ADD COLUMN     "punchOutLatitude" DOUBLE PRECISION,
ADD COLUMN     "punchOutLongitude" DOUBLE PRECISION,
ADD COLUMN     "workMode" TEXT DEFAULT 'OFFICE',
ADD COLUMN     "workingMinutes" INTEGER DEFAULT 0;

-- AlterTable
ALTER TABLE "AttendanceBreak" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "EmployeeLocation" ADD COLUMN     "distanceFromOffice" DOUBLE PRECISION,
ADD COLUMN     "locationStatus" TEXT;

-- CreateIndex
CREATE INDEX "Attendance_status_idx" ON "Attendance"("status");

-- CreateIndex
CREATE INDEX "Attendance_workMode_idx" ON "Attendance"("workMode");

-- CreateIndex
CREATE INDEX "Attendance_customerId_employeeId_date_idx" ON "Attendance"("customerId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceBreak_breakStart_idx" ON "AttendanceBreak"("breakStart");

-- CreateIndex
CREATE INDEX "EmployeeLocation_employeeId_timestamp_idx" ON "EmployeeLocation"("employeeId", "timestamp");

-- AddForeignKey
ALTER TABLE "EmployeeLocation" ADD CONSTRAINT "EmployeeLocation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
