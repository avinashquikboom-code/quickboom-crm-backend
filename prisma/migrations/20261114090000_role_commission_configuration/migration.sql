ALTER TABLE commission_configs ALTER COLUMN "employeeId" DROP NOT NULL;
ALTER TABLE commission_configs ADD COLUMN "roleId" INTEGER, ADD COLUMN name TEXT, ADD COLUMN description TEXT,
 ADD COLUMN "calculationBasis" TEXT NOT NULL DEFAULT 'FULL_PAYMENT_AMOUNT', ADD COLUMN "startsAt" TIMESTAMP(3),
 ADD COLUMN "endsAt" TIMESTAMP(3), ADD COLUMN "createdById" INTEGER, ADD COLUMN history JSONB;
ALTER TABLE commission_configs ADD CONSTRAINT "commission_configs_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"(id) ON DELETE RESTRICT;
ALTER TABLE commission_configs ADD CONSTRAINT commission_configs_owner_check CHECK (("employeeId" IS NOT NULL AND "roleId" IS NULL) OR ("employeeId" IS NULL AND "roleId" IS NOT NULL));
CREATE INDEX "commission_configs_customerId_roleId_status_idx" ON commission_configs ("customerId", "roleId", status);
ALTER TABLE commission_slabs ADD COLUMN "configurationId" INTEGER, ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commission_slabs ADD CONSTRAINT "commission_slabs_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES commission_configs(id) ON DELETE RESTRICT;
ALTER TABLE commissions ADD COLUMN "calculationSnapshot" JSONB;
-- Existing slabs without a configuration are retained for review, never guessed into a role.
-- Existing commission amounts and history are not updated.

ALTER TABLE commission_slabs ALTER COLUMN "minAmount" TYPE DECIMAL(18,2) USING "minAmount"::numeric(18,2), ALTER COLUMN "maxAmount" TYPE DECIMAL(18,2) USING "maxAmount"::numeric(18,2), ALTER COLUMN "ratePercent" TYPE DECIMAL(5,2) USING "ratePercent"::numeric(5,2);
