-- Extend the existing Coupon table for package discounts.
-- Existing rows stay valid: percentage, all plans, per-customer limit 1.

ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "discountType" TEXT NOT NULL DEFAULT 'PERCENTAGE';
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "discountValue" DOUBLE PRECISION;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "minimumAmount" DOUBLE PRECISION;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "maximumDiscountAmount" DOUBLE PRECISION;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3);
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "perCustomerLimit" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "appliesToAllPlans" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Coupon"
SET "code" = UPPER(BTRIM("code"))
WHERE "code" IS DISTINCT FROM UPPER(BTRIM("code"));

UPDATE "Coupon"
SET "discountValue" = "discountPct"
WHERE "discountValue" IS NULL;

UPDATE "Coupon"
SET "name" = "code"
WHERE "name" IS NULL OR BTRIM("name") = '';

CREATE INDEX IF NOT EXISTS "Coupon_deletedAt_idx" ON "Coupon"("deletedAt");

ALTER TABLE "customer_subscriptions" ADD COLUMN IF NOT EXISTS "couponCode" TEXT;
ALTER TABLE "customer_subscriptions" ADD COLUMN IF NOT EXISTS "originalAmount" DOUBLE PRECISION;
ALTER TABLE "customer_subscriptions" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION;
ALTER TABLE "customer_subscriptions" ADD COLUMN IF NOT EXISTS "paidAmount" DOUBLE PRECISION;

ALTER TABLE "PaymentHistory" ADD COLUMN IF NOT EXISTS "couponId" INTEGER;
ALTER TABLE "PaymentHistory" ADD COLUMN IF NOT EXISTS "couponCode" TEXT;
ALTER TABLE "PaymentHistory" ADD COLUMN IF NOT EXISTS "originalAmount" DOUBLE PRECISION;
ALTER TABLE "PaymentHistory" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION;

DO $$ BEGIN
  ALTER TABLE "PaymentHistory"
    ADD CONSTRAINT "PaymentHistory_couponId_fkey"
    FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "coupon_plans" (
  "couponId" INTEGER NOT NULL,
  "planId" INTEGER NOT NULL,
  CONSTRAINT "coupon_plans_pkey" PRIMARY KEY ("couponId", "planId")
);

DO $$ BEGIN
  ALTER TABLE "coupon_plans"
    ADD CONSTRAINT "coupon_plans_couponId_fkey"
    FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coupon_plans"
    ADD CONSTRAINT "coupon_plans_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
  "id" SERIAL NOT NULL,
  "couponId" INTEGER NOT NULL,
  "customerId" INTEGER NOT NULL,
  "planId" INTEGER NOT NULL,
  "subscriptionId" INTEGER,
  "paymentId" INTEGER,
  "couponCode" TEXT NOT NULL,
  "originalAmount" DOUBLE PRECISION NOT NULL,
  "discountAmount" DOUBLE PRECISION NOT NULL,
  "finalAmount" DOUBLE PRECISION NOT NULL,
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "coupon_redemptions_paymentId_key" ON "coupon_redemptions"("paymentId");
CREATE INDEX IF NOT EXISTS "coupon_redemptions_couponId_customerId_idx" ON "coupon_redemptions"("couponId", "customerId");

DO $$ BEGIN
  ALTER TABLE "coupon_redemptions"
    ADD CONSTRAINT "coupon_redemptions_couponId_fkey"
    FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coupon_redemptions"
    ADD CONSTRAINT "coupon_redemptions_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coupon_redemptions"
    ADD CONSTRAINT "coupon_redemptions_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coupon_redemptions"
    ADD CONSTRAINT "coupon_redemptions_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "customer_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coupon_redemptions"
    ADD CONSTRAINT "coupon_redemptions_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "PaymentHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
