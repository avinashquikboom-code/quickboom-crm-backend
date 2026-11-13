CREATE TABLE IF NOT EXISTS "google_maps_quotas" (
  "id" SERIAL NOT NULL,
  "customerId" INTEGER NOT NULL,
  "dailyLimit" INTEGER NOT NULL DEFAULT 1000,
  "monthlyLimit" INTEGER NOT NULL DEFAULT 20000,
  "warningThresholds" JSONB,
  "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "enforcementEnabled" BOOLEAN NOT NULL DEFAULT false,
  "recipients" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "apiLimits" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_maps_quotas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "google_maps_quotas_customerId_key" ON "google_maps_quotas"("customerId");

CREATE TABLE IF NOT EXISTS "google_maps_usage_daily" (
  "id" SERIAL NOT NULL,
  "customerId" INTEGER NOT NULL,
  "apiName" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0,
  "success" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_maps_usage_daily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "google_maps_usage_daily_customerId_apiName_day_key" ON "google_maps_usage_daily"("customerId", "apiName", "day");
CREATE INDEX IF NOT EXISTS "google_maps_usage_daily_customerId_day_idx" ON "google_maps_usage_daily"("customerId", "day");

CREATE TABLE IF NOT EXISTS "google_maps_usage_alerts" (
  "id" SERIAL NOT NULL,
  "customerId" INTEGER NOT NULL,
  "periodKey" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "threshold" INTEGER NOT NULL,
  "apiName" TEXT NOT NULL DEFAULT 'ALL',
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_maps_usage_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "google_maps_usage_alerts_customerId_periodKey_scope_threshold_apiName_key" ON "google_maps_usage_alerts"("customerId", "periodKey", "scope", "threshold", "apiName");
CREATE INDEX IF NOT EXISTS "google_maps_usage_alerts_customerId_createdAt_idx" ON "google_maps_usage_alerts"("customerId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'google_maps_quotas_customerId_fkey') THEN
    ALTER TABLE "google_maps_quotas" ADD CONSTRAINT "google_maps_quotas_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'google_maps_usage_daily_customerId_fkey') THEN
    ALTER TABLE "google_maps_usage_daily" ADD CONSTRAINT "google_maps_usage_daily_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'google_maps_usage_alerts_customerId_fkey') THEN
    ALTER TABLE "google_maps_usage_alerts" ADD CONSTRAINT "google_maps_usage_alerts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
