CREATE TABLE "overtime_notification_events" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "overtimeRequestId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "recipientUserId" INTEGER,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "overtime_notification_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "overtime_notification_events_idempotencyKey_key" ON "overtime_notification_events"("idempotencyKey");
CREATE INDEX "overtime_notification_events_customerId_status_idx" ON "overtime_notification_events"("customerId", "status");
CREATE INDEX "overtime_notification_events_overtimeRequestId_idx" ON "overtime_notification_events"("overtimeRequestId");
CREATE INDEX "overtime_notification_events_employeeId_idx" ON "overtime_notification_events"("employeeId");

ALTER TABLE "overtime_notification_events" ADD CONSTRAINT "overtime_notification_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "overtime_notification_events" ADD CONSTRAINT "overtime_notification_events_overtimeRequestId_fkey" FOREIGN KEY ("overtimeRequestId") REFERENCES "OvertimeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "overtime_notification_events" ADD CONSTRAINT "overtime_notification_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
