-- Existing attendance and finalized payroll remain unchanged. The application
-- ignores legacy grace settings for new late-mark calculations.
ALTER TABLE "Shift" ALTER COLUMN "gracePeriodMinutes" SET DEFAULT 0;
ALTER TABLE "AttendancePolicy" ALTER COLUMN "gracePeriodMinutes" SET DEFAULT 0;
ALTER TABLE "ShiftGuidance" ALTER COLUMN "punchInRule" SET DEFAULT 'Punch-in allowed 30 minutes prior to shift start. Late arrival recorded from shift start.';
