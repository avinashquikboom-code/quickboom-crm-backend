-- Nullable links preserve existing work and assignment history.
ALTER TABLE "Work" ADD COLUMN "customerId" INTEGER,
                   ADD COLUMN "subscriptionId" INTEGER,
                   ADD COLUMN "activityKey" TEXT;
CREATE INDEX "Work_customerId_idx" ON "Work"("customerId");
CREATE UNIQUE INDEX "Work_subscriptionId_activityKey_key" ON "Work"("subscriptionId", "activityKey");
ALTER TABLE "Work" ADD CONSTRAINT "Work_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Work" ADD CONSTRAINT "Work_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "customer_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
