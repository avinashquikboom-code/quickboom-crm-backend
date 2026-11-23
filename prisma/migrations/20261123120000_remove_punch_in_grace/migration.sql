-- Preserve previous configuration values while removing punch-in grace from the active schema.
ALTER TABLE "Shift" RENAME COLUMN "gracePeriodMinutes" TO "legacyPunchInGraceMinutes";
ALTER TABLE "AttendancePolicy" RENAME COLUMN "gracePeriodMinutes" TO "legacyPunchInGraceMinutes";
ALTER TABLE "LateMarkPolicy" RENAME COLUMN "gracePeriodMinutes" TO "legacyPunchInGraceMinutes";
