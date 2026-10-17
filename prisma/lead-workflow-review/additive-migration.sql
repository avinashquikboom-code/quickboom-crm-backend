-- REVIEW ONLY: new independent Lead workflow. Not executed.
-- Assumes the current single-organization schema, after previously reviewed removals.
-- Inspect deployed schema/migration history and back up the database before applying.
-- Adds crm_leads and nullable DataCapturePlace.importedLeadId; existing rows are not rewritten.
-- CreateEnum
CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'FOLLOW_UP', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "DataCapturePlace" ADD COLUMN     "importedLeadId" INTEGER;

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" SERIAL NOT NULL,
    "companyName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "pincode" TEXT,
    "category" TEXT,
    "googlePlaceId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdFrom" "RecordCreatedFrom" NOT NULL DEFAULT 'ADMIN_PANEL',
    "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "assignedToId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_googlePlaceId_key" ON "crm_leads"("googlePlaceId");

-- CreateIndex
CREATE INDEX "crm_leads_deletedAt_createdAt_idx" ON "crm_leads"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "crm_leads_assignedToId_idx" ON "crm_leads"("assignedToId");

-- CreateIndex
CREATE INDEX "crm_leads_createdById_idx" ON "crm_leads"("createdById");

-- CreateIndex
CREATE INDEX "DataCapturePlace_importedLeadId_idx" ON "DataCapturePlace"("importedLeadId");

-- AddForeignKey
ALTER TABLE "DataCapturePlace" ADD CONSTRAINT "DataCapturePlace_importedLeadId_fkey" FOREIGN KEY ("importedLeadId") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

