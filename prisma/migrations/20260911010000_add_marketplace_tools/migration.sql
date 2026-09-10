-- CreateTable
CREATE TABLE IF NOT EXISTS "marketplace_tools" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "icon" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GROWTH_TOOLS',
    "route" TEXT,
    "externalUrl" TEXT,
    "badge" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "marketplace_tools_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_tools_isActive_isPublished_idx" ON "marketplace_tools"("isActive", "isPublished");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_tools_sortOrder_idx" ON "marketplace_tools"("sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_tools_category_idx" ON "marketplace_tools"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_tools_deletedAt_idx" ON "marketplace_tools"("deletedAt");
