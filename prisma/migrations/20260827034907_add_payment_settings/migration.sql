-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PENDING';

-- CreateTable
CREATE TABLE "payment_settings" (
    "id" SERIAL NOT NULL,
    "singletonKey" TEXT NOT NULL DEFAULT 'DEFAULT',
    "razorpayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paymentMode" TEXT NOT NULL DEFAULT 'TEST',
    "razorpayTestKeyId" TEXT DEFAULT '',
    "razorpayTestKeySecret" TEXT DEFAULT '',
    "razorpayLiveKeyId" TEXT DEFAULT '',
    "razorpayLiveKeySecret" TEXT DEFAULT '',
    "offlinePaymentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_settings_singletonKey_key" ON "payment_settings"("singletonKey");
