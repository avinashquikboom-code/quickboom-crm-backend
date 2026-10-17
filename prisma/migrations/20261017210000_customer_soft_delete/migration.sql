ALTER TABLE "customer_accounts" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "customer_accounts_deletedAt_idx" ON "customer_accounts"("deletedAt");
