-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "distanceFromOffice" DOUBLE PRECISION,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "officeId" INTEGER;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "officeId" INTEGER;

-- CreateIndex
CREATE INDEX "Attendance_officeId_idx" ON "Attendance"("officeId");

-- CreateIndex
CREATE INDEX "Employee_officeId_idx" ON "Employee"("officeId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "BranchGeofence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "BranchGeofence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
