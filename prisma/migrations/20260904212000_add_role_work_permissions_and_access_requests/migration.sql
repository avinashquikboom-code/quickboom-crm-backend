-- CreateEnum
CREATE TYPE "WorkAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "role_work_permissions" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "roleName" TEXT NOT NULL,
    "workModule" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_work_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_access_requests" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "workModule" TEXT NOT NULL,
    "status" "WorkAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "rejectionReason" TEXT,
    "approvedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_work_permissions_customerId_idx" ON "role_work_permissions"("customerId");

-- CreateIndex
CREATE INDEX "role_work_permissions_roleName_idx" ON "role_work_permissions"("roleName");

-- CreateIndex
CREATE UNIQUE INDEX "role_work_permissions_customerId_roleName_workModule_key" ON "role_work_permissions"("customerId", "roleName", "workModule");

-- CreateIndex
CREATE INDEX "work_access_requests_customerId_idx" ON "work_access_requests"("customerId");

-- CreateIndex
CREATE INDEX "work_access_requests_employeeId_idx" ON "work_access_requests"("employeeId");

-- CreateIndex
CREATE INDEX "work_access_requests_status_idx" ON "work_access_requests"("status");

-- AddForeignKey
ALTER TABLE "role_work_permissions" ADD CONSTRAINT "role_work_permissions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_access_requests" ADD CONSTRAINT "work_access_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_access_requests" ADD CONSTRAINT "work_access_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
