-- CreateEnum
CREATE TYPE "AccessOverrideType" AS ENUM ('DEFAULT', 'ALLOW', 'DENY');

-- CreateTable
CREATE TABLE "employee_module_overrides" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "override" "AccessOverrideType" NOT NULL DEFAULT 'DEFAULT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_module_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_module_overrides_customerId_idx" ON "employee_module_overrides"("customerId");

-- CreateIndex
CREATE INDEX "employee_module_overrides_employeeId_idx" ON "employee_module_overrides"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_module_overrides_customerId_employeeId_moduleKey_key" ON "employee_module_overrides"("customerId", "employeeId", "moduleKey");

-- AddForeignKey
ALTER TABLE "employee_module_overrides" ADD CONSTRAINT "employee_module_overrides_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_module_overrides" ADD CONSTRAINT "employee_module_overrides_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
