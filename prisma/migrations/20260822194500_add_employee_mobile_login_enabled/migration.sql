-- AlterTable
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "mobileLoginEnabled" BOOLEAN NOT NULL DEFAULT true;
