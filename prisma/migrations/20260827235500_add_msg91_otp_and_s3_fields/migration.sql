-- AlterTable User: Add MSG91 OTP tracking fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "otpAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "otpLastSentAt" TIMESTAMP(3);

-- AlterTable MarketingBanner: Add imageKey field
ALTER TABLE "marketing_banners" ADD COLUMN IF NOT EXISTS "imageKey" TEXT;
