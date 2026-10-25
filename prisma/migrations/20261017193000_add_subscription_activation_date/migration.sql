-- AlterTable
ALTER TABLE "customer_subscriptions" ADD COLUMN "activationDate" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'PENDING_ACTIVATION';

-- CreateIndex
CREATE INDEX "customer_subscriptions_status_activationDate_idx" ON "customer_subscriptions"("status", "activationDate");
