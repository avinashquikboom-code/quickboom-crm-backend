-- AlterTable
ALTER TABLE "Work" ADD COLUMN     "subscriptionId" INTEGER;

-- CreateIndex
CREATE INDEX "Work_subscriptionId_idx" ON "Work"("subscriptionId");

-- AddForeignKey
ALTER TABLE "Work" ADD CONSTRAINT "Work_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "customer_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
