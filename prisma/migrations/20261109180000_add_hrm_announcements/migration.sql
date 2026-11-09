-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'DEPARTMENT', 'EMPLOYEES');

-- CreateTable
CREATE TABLE "Announcement" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
    "departmentId" INTEGER,
    "publishAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Announcement_customerId_idx" ON "Announcement"("customerId");
CREATE INDEX "Announcement_departmentId_idx" ON "Announcement"("departmentId");
CREATE INDEX "Announcement_status_idx" ON "Announcement"("status");
CREATE INDEX "Announcement_publishAt_idx" ON "Announcement"("publishAt");
CREATE INDEX "Announcement_expiresAt_idx" ON "Announcement"("expiresAt");

ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
