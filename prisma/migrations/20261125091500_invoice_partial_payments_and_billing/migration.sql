-- AlterEnum: Add PARTIALLY_PAID to InvoiceStatus safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'InvoiceStatus' AND e.enumlabel = 'PARTIALLY_PAID'
  ) THEN
    ALTER TYPE "InvoiceStatus" ADD VALUE 'PARTIALLY_PAID';
  END IF;
END $$;

-- AlterTable: Add billing, partial payment, installment, and payment link fields to Invoice
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "subscriptionId" INTEGER,
  ADD COLUMN IF NOT EXISTS "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "balanceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paymentMode" TEXT NOT NULL DEFAULT 'NOT_PAID',
  ADD COLUMN IF NOT EXISTS "lastPaymentDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nextInstallmentDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nextInstallmentAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "nextBillingDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nextBillingAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "billingCycle" TEXT,
  ADD COLUMN IF NOT EXISTS "planName" TEXT,
  ADD COLUMN IF NOT EXISTS "isOverdue" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentLinkToken" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentLinkExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentLinkAllowPartial" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_paymentLinkToken_key" ON "Invoice"("paymentLinkToken");
CREATE INDEX IF NOT EXISTS "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Invoice_subscriptionId_fkey'
  ) THEN
    ALTER TABLE "Invoice"
      ADD CONSTRAINT "Invoice_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId") REFERENCES "customer_subscriptions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateTable: invoice_payments
CREATE TABLE IF NOT EXISTS "invoice_payments" (
  "id" SERIAL NOT NULL,
  "invoiceId" INTEGER NOT NULL,
  "customerId" INTEGER NOT NULL,
  "paymentHistoryId" INTEGER,
  "amount" DOUBLE PRECISION NOT NULL,
  "paymentMode" TEXT NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "transactionRef" TEXT,
  "gatewayPaymentId" TEXT,
  "gatewayOrderId" TEXT,
  "receiptNo" TEXT,
  "proofUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
  "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remarks" TEXT,
  "recordedById" INTEGER,
  "recordedByName" TEXT,
  "verifiedById" INTEGER,
  "verifiedByName" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "refundReason" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_payments_idempotencyKey_key" ON "invoice_payments"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "invoice_payments_invoiceId_idx" ON "invoice_payments"("invoiceId");
CREATE INDEX IF NOT EXISTS "invoice_payments_customerId_idx" ON "invoice_payments"("customerId");
CREATE INDEX IF NOT EXISTS "invoice_payments_status_idx" ON "invoice_payments"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_payments_invoiceId_fkey'
  ) THEN
    ALTER TABLE "invoice_payments"
      ADD CONSTRAINT "invoice_payments_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_payments_paymentHistoryId_fkey'
  ) THEN
    ALTER TABLE "invoice_payments"
      ADD CONSTRAINT "invoice_payments_paymentHistoryId_fkey"
      FOREIGN KEY ("paymentHistoryId") REFERENCES "PaymentHistory"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateTable: invoice_communication_logs
CREATE TABLE IF NOT EXISTS "invoice_communication_logs" (
  "id" SERIAL NOT NULL,
  "invoiceId" INTEGER NOT NULL,
  "customerId" INTEGER NOT NULL,
  "channel" TEXT NOT NULL,
  "messageType" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "templateName" TEXT,
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "sentById" INTEGER,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_communication_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "invoice_communication_logs_invoiceId_idx" ON "invoice_communication_logs"("invoiceId");
CREATE INDEX IF NOT EXISTS "invoice_communication_logs_customerId_idx" ON "invoice_communication_logs"("customerId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_communication_logs_invoiceId_fkey'
  ) THEN
    ALTER TABLE "invoice_communication_logs"
      ADD CONSTRAINT "invoice_communication_logs_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill paidAmount & balanceAmount for existing PAID invoices that still have paidAmount = 0
UPDATE "Invoice"
SET "paidAmount" = "totalAmount",
    "balanceAmount" = 0,
    "paymentMode" = CASE
      WHEN "notes" ILIKE '%OFFLINE%' OR "notes" ILIKE '%CASH%' OR "notes" ILIKE '%BANK%' OR "notes" ILIKE '%CHEQUE%' THEN 'OFFLINE'
      ELSE 'ONLINE'
    END,
    "lastPaymentDate" = COALESCE("lastPaymentDate", "issueDate")
WHERE "status" = 'PAID' AND "paidAmount" = 0 AND "totalAmount" > 0 AND "deletedAt" IS NULL;

-- Backfill balanceAmount for existing PENDING/OVERDUE/DRAFT invoices
UPDATE "Invoice"
SET "balanceAmount" = GREATEST(0, "totalAmount" - "paidAmount"),
    "isOverdue" = ("status" = 'OVERDUE' OR ("status" IN ('PENDING', 'SENT') AND "dueDate" < NOW()))
WHERE "status" IN ('PENDING', 'SENT', 'OVERDUE', 'DRAFT') AND "deletedAt" IS NULL;
