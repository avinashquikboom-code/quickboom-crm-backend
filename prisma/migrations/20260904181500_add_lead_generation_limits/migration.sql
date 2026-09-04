-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "employeeId" INTEGER;

-- CreateIndex
CREATE INDEX "Lead_employeeId_idx" ON "Lead"("employeeId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "role_lead_limits" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "roleName" TEXT NOT NULL,
    "dailyLimit" INTEGER NOT NULL DEFAULT 10,
    "monthlyLimit" INTEGER NOT NULL DEFAULT 200,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_lead_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_lead_limits_customerId_idx" ON "role_lead_limits"("customerId");

-- CreateIndex
CREATE INDEX "role_lead_limits_roleName_idx" ON "role_lead_limits"("roleName");

-- CreateIndex
CREATE UNIQUE INDEX "role_lead_limits_customerId_roleName_key" ON "role_lead_limits"("customerId", "roleName");

-- AddForeignKey
ALTER TABLE "role_lead_limits" ADD CONSTRAINT "role_lead_limits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "employee_lead_limits" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "dailyLimit" INTEGER,
    "monthlyLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_lead_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_lead_limits_employeeId_key" ON "employee_lead_limits"("employeeId");

-- CreateIndex
CREATE INDEX "employee_lead_limits_customerId_idx" ON "employee_lead_limits"("customerId");

-- CreateIndex
CREATE INDEX "employee_lead_limits_employeeId_idx" ON "employee_lead_limits"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_lead_limits_customerId_employeeId_key" ON "employee_lead_limits"("customerId", "employeeId");

-- AddForeignKey
ALTER TABLE "employee_lead_limits" ADD CONSTRAINT "employee_lead_limits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_lead_limits" ADD CONSTRAINT "employee_lead_limits_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
