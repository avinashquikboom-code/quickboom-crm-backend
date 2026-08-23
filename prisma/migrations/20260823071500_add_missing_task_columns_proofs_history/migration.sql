-- AlterTable Task: Add missing category, department, designation, employee, timing and lifecycle fields
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "departmentId" INTEGER;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "designationId" INTEGER;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "employeeId" INTEGER;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "startTime" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);

-- CreateTable TaskProof
CREATE TABLE IF NOT EXISTS "TaskProof" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "employeeId" INTEGER,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "fileType" TEXT,
    "fileSize" INTEGER,
    "comment" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable TaskHistory
CREATE TABLE IF NOT EXISTS "TaskHistory" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "performedById" INTEGER,
    "performedByName" TEXT,
    "oldStatus" TEXT,
    "newStatus" TEXT,
    "previousEmployeeId" INTEGER,
    "previousEmployeeName" TEXT,
    "newEmployeeId" INTEGER,
    "newEmployeeName" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "Task_employeeId_idx" ON "Task"("employeeId");
CREATE INDEX IF NOT EXISTS "Task_departmentId_idx" ON "Task"("departmentId");
CREATE INDEX IF NOT EXISTS "TaskProof_taskId_idx" ON "TaskProof"("taskId");
CREATE INDEX IF NOT EXISTS "TaskProof_employeeId_idx" ON "TaskProof"("employeeId");
CREATE INDEX IF NOT EXISTS "TaskHistory_taskId_idx" ON "TaskHistory"("taskId");

-- AddForeignKeys
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Task_departmentId_fkey') THEN
        ALTER TABLE "Task" ADD CONSTRAINT "Task_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Task_designationId_fkey') THEN
        ALTER TABLE "Task" ADD CONSTRAINT "Task_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Task_employeeId_fkey') THEN
        ALTER TABLE "Task" ADD CONSTRAINT "Task_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskProof_taskId_fkey') THEN
        ALTER TABLE "TaskProof" ADD CONSTRAINT "TaskProof_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskHistory_taskId_fkey') THEN
        ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
