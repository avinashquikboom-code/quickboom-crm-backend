-- AlterTable BranchGeofence to add optional code, address, state, country, and postalCode
ALTER TABLE "BranchGeofence" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "BranchGeofence" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "BranchGeofence" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "BranchGeofence" ADD COLUMN IF NOT EXISTS "country" TEXT DEFAULT 'India';
ALTER TABLE "BranchGeofence" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
