-- CreateTable
CREATE TABLE "email_templates" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT DEFAULT 'GENERAL',
    "supportedVariables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_templates_key_idx" ON "email_templates"("key");

-- CreateIndex
CREATE INDEX "email_templates_customerId_idx" ON "email_templates"("customerId");

-- CreateIndex
CREATE INDEX "email_templates_isActive_idx" ON "email_templates"("isActive");

-- CreateIndex
CREATE INDEX "email_templates_deletedAt_idx" ON "email_templates"("deletedAt");

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
