CREATE TABLE IF NOT EXISTS "visit_photos" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "visitId" INTEGER NOT NULL,
    "leadId" INTEGER,
    "employeeId" INTEGER,
    "url" TEXT NOT NULL,
    "key" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visit_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "visit_photos_customerId_idx" ON "visit_photos"("customerId");
CREATE INDEX IF NOT EXISTS "visit_photos_visitId_idx" ON "visit_photos"("visitId");
CREATE INDEX IF NOT EXISTS "visit_photos_leadId_idx" ON "visit_photos"("leadId");
CREATE INDEX IF NOT EXISTS "visit_photos_employeeId_idx" ON "visit_photos"("employeeId");

DO $$ BEGIN
  ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
