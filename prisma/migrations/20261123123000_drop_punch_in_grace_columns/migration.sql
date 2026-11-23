-- Destructive: removes obsolete punch-in configuration values only.
-- Review and back up the target database before applying.
ALTER TABLE "AttendancePolicy" DROP COLUMN "gracePeriodMinutes";
ALTER TABLE "LateMarkPolicy" DROP COLUMN "gracePeriodMinutes";
ALTER TABLE "Shift" DROP COLUMN "gracePeriodMinutes";
