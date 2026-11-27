-- Bring the telecaller target and performance tables in line with schema.prisma
-- DropForeignKey
ALTER TABLE "daily_performance_reports" DROP CONSTRAINT "daily_performance_reports_customerId_fkey";
-- DropForeignKey
ALTER TABLE "daily_performance_reports" DROP CONSTRAINT "daily_performance_reports_employeeId_fkey";
-- DropForeignKey
ALTER TABLE "daily_performance_snapshots" DROP CONSTRAINT "daily_performance_snapshots_customerId_fkey";
-- DropForeignKey
ALTER TABLE "daily_performance_snapshots" DROP CONSTRAINT "daily_performance_snapshots_employeeId_fkey";
-- DropForeignKey
ALTER TABLE "telecaller_activity_events" DROP CONSTRAINT "telecaller_activity_events_customerId_fkey";
-- DropForeignKey
ALTER TABLE "telecaller_activity_events" DROP CONSTRAINT "telecaller_activity_events_employeeId_fkey";
-- DropForeignKey
ALTER TABLE "telecaller_target_assignments" DROP CONSTRAINT "telecaller_target_assignments_customerId_fkey";
-- DropForeignKey
ALTER TABLE "telecaller_target_assignments" DROP CONSTRAINT "telecaller_target_assignments_employeeId_fkey";
-- DropForeignKey
ALTER TABLE "telecaller_target_histories" DROP CONSTRAINT "telecaller_target_histories_assignmentId_fkey";
-- DropForeignKey
ALTER TABLE "telecaller_target_policies" DROP CONSTRAINT "telecaller_target_policies_customerId_fkey";
-- AlterTable
ALTER TABLE "daily_performance_reports" ALTER COLUMN "updatedAt" DROP DEFAULT;
-- AlterTable
ALTER TABLE "daily_performance_snapshots" ALTER COLUMN "updatedAt" DROP DEFAULT;
-- AlterTable
ALTER TABLE "telecaller_target_assignments" ALTER COLUMN "updatedAt" DROP DEFAULT;
-- AlterTable
ALTER TABLE "telecaller_target_policies" ALTER COLUMN "updatedAt" DROP DEFAULT;
-- CreateIndex
CREATE INDEX "daily_performance_reports_customerId_businessDate_idx" ON "daily_performance_reports"("customerId", "businessDate");
-- CreateIndex
CREATE INDEX "daily_performance_reports_emailStatus_whatsappStatus_nextRe_idx" ON "daily_performance_reports"("emailStatus", "whatsappStatus", "nextRetryAt");
-- CreateIndex
CREATE INDEX "daily_performance_snapshots_customerId_businessDate_idx" ON "daily_performance_snapshots"("customerId", "businessDate");
-- CreateIndex
CREATE INDEX "telecaller_activity_events_customerId_businessDate_idx" ON "telecaller_activity_events"("customerId", "businessDate");
-- CreateIndex
CREATE INDEX "telecaller_target_histories_customerId_createdAt_idx" ON "telecaller_target_histories"("customerId", "createdAt");
-- AddForeignKey
ALTER TABLE "telecaller_target_policies" ADD CONSTRAINT "telecaller_target_policies_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "telecaller_target_assignments" ADD CONSTRAINT "telecaller_target_assignments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "telecaller_target_assignments" ADD CONSTRAINT "telecaller_target_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "telecaller_target_histories" ADD CONSTRAINT "telecaller_target_histories_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "telecaller_target_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "telecaller_activity_events" ADD CONSTRAINT "telecaller_activity_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "telecaller_activity_events" ADD CONSTRAINT "telecaller_activity_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "daily_performance_snapshots" ADD CONSTRAINT "daily_performance_snapshots_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "daily_performance_snapshots" ADD CONSTRAINT "daily_performance_snapshots_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "daily_performance_reports" ADD CONSTRAINT "daily_performance_reports_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "daily_performance_reports" ADD CONSTRAINT "daily_performance_reports_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RenameIndex
ALTER INDEX "telecaller_activity_events_lookup_idx" RENAME TO "telecaller_activity_events_customerId_employeeId_businessDa_idx";
-- RenameIndex
ALTER INDEX "telecaller_target_assignments_dept_idx" RENAME TO "telecaller_target_assignments_customerId_departmentId_perio_idx";
-- RenameIndex
ALTER INDEX "telecaller_target_assignments_emp_idx" RENAME TO "telecaller_target_assignments_customerId_employeeId_periodT_idx";
-- RenameIndex
ALTER INDEX "telecaller_target_assignments_metric_idx" RENAME TO "telecaller_target_assignments_customerId_metricKey_effectiv_idx";
-- RenameIndex
ALTER INDEX "telecaller_target_histories_assign_idx" RENAME TO "telecaller_target_histories_assignmentId_createdAt_idx";
