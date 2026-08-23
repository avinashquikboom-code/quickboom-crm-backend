-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_customerId_deletedAt_createdAt_idx" ON "Lead"("customerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Lead_customerId_status_deletedAt_idx" ON "Lead"("customerId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_customerId_deletedAt_createdAt_idx" ON "Task"("customerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_assignedToId_status_deletedAt_idx" ON "Task"("assignedToId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_customerId_createdAt_idx" ON "Notification"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DataCapturePlace_customerId_deletedAt_createdAt_idx" ON "DataCapturePlace"("customerId", "deletedAt", "createdAt");
