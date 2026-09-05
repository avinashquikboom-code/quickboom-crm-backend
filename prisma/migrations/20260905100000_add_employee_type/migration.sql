-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('COMPANY', 'FREELANCER');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "city" TEXT,
ADD COLUMN     "employeeType" "EmployeeType" NOT NULL DEFAULT 'COMPANY';
