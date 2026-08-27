-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'DUE', 'UPCOMING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateTable
CREATE TABLE "subscription_installments" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "subscriptionId" INTEGER NOT NULL,
    "installmentNumber" INTEGER NOT NULL DEFAULT 1,
    "totalInstallments" INTEGER NOT NULL DEFAULT 3,
    "title" TEXT NOT NULL DEFAULT 'Installment',
    "amount" DOUBLE PRECISION NOT NULL,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "bufferDays" INTEGER NOT NULL DEFAULT 3,
    "bufferEndDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paymentHistoryId" INTEGER,
    "invoiceId" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "subscription_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_installments_customerId_idx" ON "subscription_installments"("customerId");

-- CreateIndex
CREATE INDEX "subscription_installments_subscriptionId_idx" ON "subscription_installments"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_installments_status_idx" ON "subscription_installments"("status");

-- CreateIndex
CREATE INDEX "subscription_installments_dueDate_idx" ON "subscription_installments"("dueDate");

-- CreateIndex
CREATE INDEX "subscription_installments_bufferEndDate_idx" ON "subscription_installments"("bufferEndDate");

-- AddForeignKey
ALTER TABLE "subscription_installments" ADD CONSTRAINT "subscription_installments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_installments" ADD CONSTRAINT "subscription_installments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "customer_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_installments" ADD CONSTRAINT "subscription_installments_paymentHistoryId_fkey" FOREIGN KEY ("paymentHistoryId") REFERENCES "PaymentHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_installments" ADD CONSTRAINT "subscription_installments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
