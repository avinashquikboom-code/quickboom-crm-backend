ALTER TABLE "customer_accounts"
ADD COLUMN "crmCompanyId" INTEGER;

CREATE UNIQUE INDEX "customer_accounts_crmCompanyId_key"
ON "customer_accounts"("crmCompanyId");

ALTER TABLE "customer_accounts"
ADD CONSTRAINT "customer_accounts_crmCompanyId_fkey"
FOREIGN KEY ("crmCompanyId") REFERENCES "Company"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Work"
ADD COLUMN "companyId" INTEGER;

CREATE INDEX "Work_companyId_idx" ON "Work"("companyId");

ALTER TABLE "Work"
ADD CONSTRAINT "Work_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
