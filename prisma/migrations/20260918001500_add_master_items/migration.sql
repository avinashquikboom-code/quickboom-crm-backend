-- CreateTable
CREATE TABLE "master_items" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "master_items_type_customerId_idx" ON "master_items"("type", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "master_items_type_code_customerId_key" ON "master_items"("type", "code", "customerId");

-- AddForeignKey
ALTER TABLE "master_items" ADD CONSTRAINT "master_items_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
