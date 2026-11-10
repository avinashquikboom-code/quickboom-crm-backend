-- CreateTable
CREATE TABLE IF NOT EXISTS "general_settings" (
    "id" SERIAL NOT NULL,
    "singletonKey" TEXT NOT NULL DEFAULT 'DEFAULT',
    "appName" TEXT NOT NULL DEFAULT 'QB Suite',
    "appLogoUrl" TEXT,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "availableLanguages" TEXT[] DEFAULT ARRAY['en', 'mr']::TEXT[],
    "defaultLocale" TEXT NOT NULL DEFAULT 'en-IN',
    "defaultTimezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "dateFormat" TEXT NOT NULL DEFAULT 'DD-MM-YYYY',
    "timeFormat" TEXT NOT NULL DEFAULT '12h',
    "firstDayOfWeek" TEXT NOT NULL DEFAULT 'Monday',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'INR',
    "currencySymbol" TEXT NOT NULL DEFAULT '₹',
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "decimalPrecision" INTEGER NOT NULL DEFAULT 2,
    "numberFormatting" TEXT NOT NULL DEFAULT 'en-IN',
    "currencyDisplayFormat" TEXT NOT NULL DEFAULT 'SYMBOL_FIRST',
    "faviconUrl" TEXT,
    "loginPageBranding" TEXT,
    "primaryColor" TEXT DEFAULT '#163A2E',
    "secondaryColor" TEXT DEFAULT '#204C3D',
    "paleColor" TEXT DEFAULT '#E8F1EC',
    "configVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "lastSyncedAt" TIMESTAMP(3),
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "general_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "general_settings_singletonKey_key" ON "general_settings"("singletonKey");
