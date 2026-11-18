ALTER TABLE "meta_templates"
  ADD COLUMN "deletionState" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "deletionError" TEXT,
  ADD COLUMN "deletionAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastDeletionAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" INTEGER,
  ADD COLUMN "deletedByName" TEXT;
