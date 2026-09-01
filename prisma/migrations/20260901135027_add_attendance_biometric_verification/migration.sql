-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "punchInBiometricVerified" BOOLEAN DEFAULT false,
ADD COLUMN     "punchOutBiometricVerified" BOOLEAN DEFAULT false;
