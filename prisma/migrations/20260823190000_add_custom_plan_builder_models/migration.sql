-- CreateTable
CREATE TABLE "custom_plan_options" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'CONTENT',
    "monthlyPrice" DOUBLE PRECISION NOT NULL,
    "pricingType" TEXT NOT NULL DEFAULT 'PER_UNIT',
    "unitName" TEXT DEFAULT 'unit',
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "maxQuantity" INTEGER NOT NULL DEFAULT 100,
    "defaultQuantity" INTEGER NOT NULL DEFAULT 1,
    "isIncludedInStandard" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "custom_plan_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_plan_orders" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "subscriptionId" INTEGER,
    "orderNumber" TEXT NOT NULL,
    "selectedFeatures" JSONB NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 1,
    "durationUnit" TEXT NOT NULL DEFAULT 'MONTH',
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'RAZORPAY',
    "paymentId" TEXT,
    "orderId" TEXT,
    "transactionId" TEXT,
    "startDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "custom_plan_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_plan_options_code_key" ON "custom_plan_options"("code");
CREATE INDEX "custom_plan_options_category_idx" ON "custom_plan_options"("category");
CREATE INDEX "custom_plan_options_isActive_idx" ON "custom_plan_options"("isActive");
CREATE INDEX "custom_plan_options_deletedAt_idx" ON "custom_plan_options"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "custom_plan_orders_orderNumber_key" ON "custom_plan_orders"("orderNumber");
CREATE INDEX "custom_plan_orders_customerId_idx" ON "custom_plan_orders"("customerId");
CREATE INDEX "custom_plan_orders_subscriptionId_idx" ON "custom_plan_orders"("subscriptionId");
CREATE INDEX "custom_plan_orders_orderNumber_idx" ON "custom_plan_orders"("orderNumber");
CREATE INDEX "custom_plan_orders_status_idx" ON "custom_plan_orders"("status");
CREATE INDEX "custom_plan_orders_deletedAt_idx" ON "custom_plan_orders"("deletedAt");

-- AddForeignKey
ALTER TABLE "custom_plan_orders" ADD CONSTRAINT "custom_plan_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_plan_orders" ADD CONSTRAINT "custom_plan_orders_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "customer_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
