-- AlterTable Task
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

-- AlterTable Employee
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "shiftId" INTEGER;

-- CreateTable Shift
CREATE TABLE IF NOT EXISTS "Shift" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startTime" TEXT NOT NULL DEFAULT '09:30 AM',
    "endTime" TEXT NOT NULL DEFAULT '06:30 PM',
    "durationHours" DOUBLE PRECISION NOT NULL DEFAULT 9.0,
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 15,
    "halfDayThresholdHours" DOUBLE PRECISION NOT NULL DEFAULT 4.5,
    "breakDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "isNightShift" BOOLEAN NOT NULL DEFAULT false,
    "isRotational" BOOLEAN NOT NULL DEFAULT false,
    "workingDays" TEXT[] DEFAULT ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']::TEXT[],
    "color" TEXT DEFAULT '#3B82F6',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable ShiftGuidance
CREATE TABLE IF NOT EXISTS "ShiftGuidance" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "overtimeRule" TEXT DEFAULT 'Overtime commences after 9 hours of active shift work; calculated at 1.5x regular hourly wage.',
    "punchInRule" TEXT DEFAULT 'Punch-in allowed 30 minutes prior to shift start. Late arrival recorded after 15-minute grace period.',
    "punchOutRule" TEXT DEFAULT 'Early departure before shift completion requires manager half-day authorization.',
    "breakPolicy" TEXT DEFAULT '1-hour lunch break between 01:00 PM and 02:00 PM + two 15-minute tea breaks.',
    "nightShiftAllowance" TEXT DEFAULT '₹250 per night shift allowance + complimentary company transport.',
    "swapPolicy" TEXT DEFAULT 'Shift swap requests must be submitted at least 24 hours in advance with mutual employee approval.',
    "geofenceRequirement" TEXT DEFAULT 'Mandatory punch within 150m of assigned office geofence or approved client site.',
    "emergencyContactProtocol" TEXT DEFAULT 'Contact HR Duty Manager immediately for emergency shift cancellations.',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftGuidance_pkey" PRIMARY KEY ("id")
);

-- CreateTable DataCaptureJob
CREATE TABLE IF NOT EXISTS "DataCaptureJob" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "keyword" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "requestedResults" INTEGER NOT NULL DEFAULT 20,
    "capturedResults" INTEGER NOT NULL DEFAULT 0,
    "googleApiRequests" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataCaptureJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable DataCapturePlace
CREATE TABLE IF NOT EXISTS "DataCapturePlace" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "googlePlaceId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "category" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "googleMapsUrl" TEXT,
    "businessStatus" TEXT DEFAULT 'OPERATIONAL',
    "isImported" BOOLEAN NOT NULL DEFAULT false,
    "importedLeadId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataCapturePlace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Shift_customerId_code_key" ON "Shift"("customerId", "code");
CREATE INDEX IF NOT EXISTS "Shift_customerId_idx" ON "Shift"("customerId");
CREATE INDEX IF NOT EXISTS "Shift_status_idx" ON "Shift"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "ShiftGuidance_shiftId_key" ON "ShiftGuidance"("shiftId");
CREATE INDEX IF NOT EXISTS "ShiftGuidance_customerId_idx" ON "ShiftGuidance"("customerId");

CREATE UNIQUE INDEX IF NOT EXISTS "DataCaptureJob_jobId_key" ON "DataCaptureJob"("jobId");
CREATE INDEX IF NOT EXISTS "DataCaptureJob_customerId_idx" ON "DataCaptureJob"("customerId");
CREATE INDEX IF NOT EXISTS "DataCaptureJob_jobId_idx" ON "DataCaptureJob"("jobId");

CREATE INDEX IF NOT EXISTS "DataCapturePlace_jobId_idx" ON "DataCapturePlace"("jobId");
CREATE INDEX IF NOT EXISTS "DataCapturePlace_customerId_idx" ON "DataCapturePlace"("customerId");
CREATE INDEX IF NOT EXISTS "DataCapturePlace_googlePlaceId_idx" ON "DataCapturePlace"("googlePlaceId");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_shiftId_fkey') THEN
        ALTER TABLE "Employee" ADD CONSTRAINT "Employee_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Shift_customerId_fkey') THEN
        ALTER TABLE "Shift" ADD CONSTRAINT "Shift_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShiftGuidance_shiftId_fkey') THEN
        ALTER TABLE "ShiftGuidance" ADD CONSTRAINT "ShiftGuidance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShiftGuidance_customerId_fkey') THEN
        ALTER TABLE "ShiftGuidance" ADD CONSTRAINT "ShiftGuidance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DataCaptureJob_customerId_fkey') THEN
        ALTER TABLE "DataCaptureJob" ADD CONSTRAINT "DataCaptureJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DataCaptureJob_userId_fkey') THEN
        ALTER TABLE "DataCaptureJob" ADD CONSTRAINT "DataCaptureJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DataCapturePlace_jobId_fkey') THEN
        ALTER TABLE "DataCapturePlace" ADD CONSTRAINT "DataCapturePlace_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DataCaptureJob"("jobId") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DataCapturePlace_customerId_fkey') THEN
        ALTER TABLE "DataCapturePlace" ADD CONSTRAINT "DataCapturePlace_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
