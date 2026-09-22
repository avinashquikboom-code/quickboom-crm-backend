-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_customerId_phone_idx" ON "Lead"("customerId", "phone");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_customerId_email_idx" ON "Lead"("customerId", "email");
