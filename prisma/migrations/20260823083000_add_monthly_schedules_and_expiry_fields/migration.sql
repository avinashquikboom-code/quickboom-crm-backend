-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'OVERDUE');

-- AlterTable
ALTER TABLE "customer_subscriptions" ADD COLUMN "duration" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "customer_subscriptions" ADD COLUMN "durationUnit" TEXT NOT NULL DEFAULT 'MONTH';

-- CreateTable
CREATE TABLE "monthly_schedules" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "subscriptionId" INTEGER,
    "planId" INTEGER,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'PLANNED',
    "assignedEmployeeId" INTEGER,
    "title" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "monthly_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_schedules_customerId_subscriptionId_month_year_key" ON "monthly_schedules"("customerId", "subscriptionId", "month", "year");

-- CreateIndex
CREATE INDEX "monthly_schedules_customerId_idx" ON "monthly_schedules"("customerId");

-- CreateIndex
CREATE INDEX "monthly_schedules_subscriptionId_idx" ON "monthly_schedules"("subscriptionId");

-- CreateIndex
CREATE INDEX "monthly_schedules_planId_idx" ON "monthly_schedules"("planId");

-- CreateIndex
CREATE INDEX "monthly_schedules_assignedEmployeeId_idx" ON "monthly_schedules"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "monthly_schedules_startDate_idx" ON "monthly_schedules"("startDate");

-- CreateIndex
CREATE INDEX "monthly_schedules_endDate_idx" ON "monthly_schedules"("endDate");

-- CreateIndex
CREATE INDEX "monthly_schedules_status_idx" ON "monthly_schedules"("status");

-- CreateIndex
CREATE INDEX "monthly_schedules_month_year_idx" ON "monthly_schedules"("month", "year");

-- CreateIndex
CREATE INDEX "monthly_schedules_deletedAt_idx" ON "monthly_schedules"("deletedAt");

-- AddForeignKey
ALTER TABLE "monthly_schedules" ADD CONSTRAINT "monthly_schedules_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_schedules" ADD CONSTRAINT "monthly_schedules_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "customer_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_schedules" ADD CONSTRAINT "monthly_schedules_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_schedules" ADD CONSTRAINT "monthly_schedules_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
