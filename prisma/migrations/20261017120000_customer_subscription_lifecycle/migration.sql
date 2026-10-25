-- The current independent Lead model predates its migration history.
-- Preserve an existing crm_leads table; create the current schema only if absent.
DO $$ BEGIN
  CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'DETAILS_SEND', 'FOLLOW_UP', 'VISIT_SCHEDULED', 'VISIT_DONE', 'PROPOSAL_SENT', 'NEGOTIATION', 'FINAL_CALL', 'WON', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS "crm_leads" (
  "id" SERIAL PRIMARY KEY,
  "companyName" TEXT NOT NULL,
  "firstName" TEXT, "lastName" TEXT, "phone" TEXT, "email" TEXT,
  "website" TEXT, "address" TEXT, "city" TEXT, "state" TEXT, "country" TEXT,
  "pincode" TEXT, "category" TEXT, "googlePlaceId" TEXT UNIQUE,
  "latitude" DOUBLE PRECISION, "longitude" DOUBLE PRECISION,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdFrom" "RecordCreatedFrom" NOT NULL DEFAULT 'ADMIN_PANEL',
  "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW', "notes" TEXT,
  "assignedToId" INTEGER REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdById" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "crm_leads_deletedAt_createdAt_idx" ON "crm_leads"("deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "crm_leads_assignedToId_idx" ON "crm_leads"("assignedToId");
CREATE INDEX IF NOT EXISTS "crm_leads_createdById_idx" ON "crm_leads"("createdById");

-- CreateEnum
CREATE TYPE "CustomerLifecycleStatus" AS ENUM ('INACTIVE', 'ACTIVE');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "billingIntervals" TEXT[] DEFAULT ARRAY['MONTHLY', 'YEARLY']::TEXT[],
ADD COLUMN     "isRecommended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxRateBps" INTEGER NOT NULL DEFAULT 1800,
ADD COLUMN     "yearlyDiscountBps" INTEGER NOT NULL DEFAULT 2000;

-- Initialize the new recommendation setting without changing any existing price.
UPDATE "Plan" SET "isRecommended" = true WHERE "code" = 'STANDARD';

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" SERIAL NOT NULL,
    "originLeadId" INTEGER NOT NULL,
    "userId" INTEGER,
    "companyName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" "CustomerLifecycleStatus" NOT NULL DEFAULT 'INACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_subscriptions" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "planId" INTEGER NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_checkouts" (
    "id" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "planId" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "billingCycle" "SubscriptionBillingCycle" NOT NULL,
    "basePaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "taxRateBps" INTEGER NOT NULL,
    "yearlyDiscountBps" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT,
    "paymentId" TEXT,
    "paymentHistoryId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_originLeadId_key" ON "customer_accounts"("originLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_userId_key" ON "customer_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_subscriptions_checkoutId_key" ON "customer_subscriptions"("checkoutId");

-- CreateIndex
CREATE INDEX "customer_subscriptions_customerId_status_endDate_idx" ON "customer_subscriptions"("customerId", "status", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "customer_checkouts_orderId_key" ON "customer_checkouts"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_checkouts_paymentId_key" ON "customer_checkouts"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_checkouts_paymentHistoryId_key" ON "customer_checkouts"("paymentHistoryId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_checkouts_customerId_idempotencyKey_key" ON "customer_checkouts"("customerId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_originLeadId_fkey" FOREIGN KEY ("originLeadId") REFERENCES "crm_leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_subscriptions" ADD CONSTRAINT "customer_subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_subscriptions" ADD CONSTRAINT "customer_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_subscriptions" ADD CONSTRAINT "customer_subscriptions_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "customer_checkouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_checkouts" ADD CONSTRAINT "customer_checkouts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_checkouts" ADD CONSTRAINT "customer_checkouts_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Seed missing defaults once; preserve customized existing plans.
INSERT INTO "Plan" ("name","code","description","monthlyPrice","yearlyPrice","userLimit","storageLimit","features","isActive","isRecommended","updatedAt") VALUES ('Basic Package','BASIC','Starter Plan for emerging businesses',9999,95990.40,5,5368709120,'["4 Reels","3 Creative Posts","1 Influencer Promotion","3 Stories","Social Media Account Management","Content Writing & Captions","Trending Hashtags","Meta Ads Campaign Setup & Management","Google Ads Campaign Setup & Management","Monthly Performance Report","Ads will run only during the content execution period.","Meta & Google Ads Budget will be paid by the client."]'::jsonb,true,false,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
INSERT INTO "Plan" ("name","code","description","monthlyPrice","yearlyPrice","userLimit","storageLimit","features","isActive","isRecommended","updatedAt") VALUES ('Standard Package','STANDARD','Growth Plan for expanding companies',14999,143990.40,25,26843545600,'["6 Reels","4 Creative Posts","2 Influencer Promotions","5 Stories","Social Media Account Management","Trending Hashtags","Meta Ads Campaign Setup & Management","Google Ads Campaign Setup & Management","Monthly Performance Report","Ads will run only during the content execution period.","Meta & Google Ads Budget will be paid by the client."]'::jsonb,true,true,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
INSERT INTO "Plan" ("name","code","description","monthlyPrice","yearlyPrice","userLimit","storageLimit","features","isActive","isRecommended","updatedAt") VALUES ('Premium Package','PREMIUM','Scale Plan for enterprise-level growth',25999,249590.40,100,107374182400,'["2 Product Reels","8 Influencer Reels (Total 10 Reels)","8 Creative Posts","30 Stories","Complete Social Media Management","Premium Content Strategy & Caption Writing","Advanced Hashtag Research","Meta Ads Campaign Setup & Management","Google Ads Campaign Setup & Management","Detailed Monthly Analytics Report","Priority Graphic Designing","Ads will run throughout the campaign/content execution period.","Meta & Google Ads Budget will be paid by the client."]'::jsonb,true,false,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;

ALTER TABLE "Plan" ADD CONSTRAINT "Plan_billing_rates_check" CHECK ("taxRateBps" BETWEEN 0 AND 10000 AND "yearlyDiscountBps" BETWEEN 0 AND 10000);
ALTER TABLE "customer_checkouts" ADD CONSTRAINT "customer_checkout_amounts_check" CHECK ("basePaise" >= 0 AND "discountPaise" >= 0 AND "taxablePaise" = "basePaise" - "discountPaise" AND "gstPaise" >= 0 AND "totalPaise" = "taxablePaise" + "gstPaise");
