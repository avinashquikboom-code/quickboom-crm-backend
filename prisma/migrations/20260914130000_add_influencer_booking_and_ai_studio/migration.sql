-- AlterTable influencers
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "coverImage" TEXT;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "localArea" TEXT;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'ACTIVE';
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT DEFAULT 'VERIFIED';
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "topCreator" BOOLEAN DEFAULT false;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "startingPrice" DOUBLE PRECISION;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "languages" TEXT[] DEFAULT ARRAY['English', 'Hindi']::TEXT[];
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "instagramHandle" TEXT;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "youtubeHandle" TEXT;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "influencers" ADD COLUMN IF NOT EXISTS "ageRange" TEXT;

-- CreateTable influencer_packages
CREATE TABLE IF NOT EXISTS "influencer_packages" (
    "id" SERIAL NOT NULL,
    "influencerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'POST',
    "description" TEXT,
    "duration" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "influencer_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable influencer_availabilities
CREATE TABLE IF NOT EXISTS "influencer_availabilities" (
    "id" SERIAL NOT NULL,
    "influencerId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "startTime" TEXT,
    "endTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "influencer_availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable influencer_bookings
CREATE TABLE IF NOT EXISTS "influencer_bookings" (
    "id" SERIAL NOT NULL,
    "bookingId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "influencerId" INTEGER NOT NULL,
    "packageId" INTEGER,
    "campaignDate" TIMESTAMP(3) NOT NULL,
    "brandName" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "instagramId" TEXT,
    "campaignObjective" TEXT,
    "notes" TEXT,
    "packageAmount" DOUBLE PRECISION NOT NULL,
    "platformFee" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "gst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "bookingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT DEFAULT 'RAZORPAY',
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "influencer_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable influencer_booking_payments
CREATE TABLE IF NOT EXISTS "influencer_booking_payments" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentMethod" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "paymentId" TEXT,
    "orderId" TEXT,
    "signature" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "influencer_booking_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable influencer_portfolios
CREATE TABLE IF NOT EXISTS "influencer_portfolios" (
    "id" SERIAL NOT NULL,
    "influencerId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "mediaUrl" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
    "caption" TEXT,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "influencer_portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable influencer_reviews
CREATE TABLE IF NOT EXISTS "influencer_reviews" (
    "id" SERIAL NOT NULL,
    "influencerId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "brandName" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "influencer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_service_configs
CREATE TABLE IF NOT EXISTS "ai_service_configs" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "creditCost" INTEGER NOT NULL DEFAULT 1,
    "pricePerCredit" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "packPrice" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_service_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_credit_wallets
CREATE TABLE IF NOT EXISTS "ai_credit_wallets" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 20,
    "totalEarned" INTEGER NOT NULL DEFAULT 20,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_credit_transactions
CREATE TABLE IF NOT EXISTS "ai_credit_transactions" (
    "id" SERIAL NOT NULL,
    "walletId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "serviceCode" TEXT,
    "generationId" INTEGER,
    "paymentId" TEXT,
    "razorpayOrderId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_generations
CREATE TABLE IF NOT EXISTS "ai_generations" (
    "id" SERIAL NOT NULL,
    "generationId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "product" TEXT NOT NULL,
    "objective" TEXT,
    "targetAudience" TEXT,
    "platform" TEXT,
    "language" TEXT DEFAULT 'English',
    "tone" TEXT DEFAULT 'Premium',
    "cta" TEXT,
    "instructions" TEXT,
    "creditsSpent" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mediaUrl" TEXT,
    "mediaType" TEXT DEFAULT 'IMAGE',
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_generation_assets
CREATE TABLE IF NOT EXISTS "ai_generation_assets" (
    "id" SERIAL NOT NULL,
    "generationId" INTEGER NOT NULL,
    "assetType" TEXT NOT NULL DEFAULT 'IMAGE',
    "url" TEXT NOT NULL,
    "fileKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable social_accounts
CREATE TABLE IF NOT EXISTS "social_accounts" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "username" TEXT,
    "profilePic" TEXT,
    "externalAccountId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isConnected" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable social_publishes
CREATE TABLE IF NOT EXISTS "social_publishes" (
    "id" SERIAL NOT NULL,
    "publishId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "socialAccountId" INTEGER NOT NULL,
    "generationId" INTEGER,
    "platform" TEXT NOT NULL,
    "content" TEXT,
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "externalPostUrl" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_publishes_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX IF NOT EXISTS "influencer_bookings_bookingId_key" ON "influencer_bookings"("bookingId");
CREATE INDEX IF NOT EXISTS "influencer_packages_influencerId_idx" ON "influencer_packages"("influencerId");
CREATE INDEX IF NOT EXISTS "influencer_packages_status_idx" ON "influencer_packages"("status");
CREATE INDEX IF NOT EXISTS "influencer_availabilities_influencerId_date_idx" ON "influencer_availabilities"("influencerId", "date");
CREATE INDEX IF NOT EXISTS "influencer_bookings_customerId_idx" ON "influencer_bookings"("customerId");
CREATE INDEX IF NOT EXISTS "influencer_bookings_influencerId_idx" ON "influencer_bookings"("influencerId");
CREATE INDEX IF NOT EXISTS "influencer_bookings_bookingStatus_idx" ON "influencer_bookings"("bookingStatus");
CREATE INDEX IF NOT EXISTS "influencer_bookings_paymentStatus_idx" ON "influencer_bookings"("paymentStatus");
CREATE INDEX IF NOT EXISTS "influencer_bookings_deletedAt_idx" ON "influencer_bookings"("deletedAt");
CREATE INDEX IF NOT EXISTS "influencer_booking_payments_bookingId_idx" ON "influencer_booking_payments"("bookingId");
CREATE INDEX IF NOT EXISTS "influencer_booking_payments_customerId_idx" ON "influencer_booking_payments"("customerId");
CREATE INDEX IF NOT EXISTS "influencer_portfolios_influencerId_idx" ON "influencer_portfolios"("influencerId");
CREATE INDEX IF NOT EXISTS "influencer_reviews_influencerId_idx" ON "influencer_reviews"("influencerId");

CREATE UNIQUE INDEX IF NOT EXISTS "ai_service_configs_code_key" ON "ai_service_configs"("code");
CREATE INDEX IF NOT EXISTS "ai_service_configs_code_idx" ON "ai_service_configs"("code");
CREATE INDEX IF NOT EXISTS "ai_service_configs_isActive_idx" ON "ai_service_configs"("isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "ai_credit_wallets_customerId_key" ON "ai_credit_wallets"("customerId");
CREATE INDEX IF NOT EXISTS "ai_credit_wallets_customerId_idx" ON "ai_credit_wallets"("customerId");

CREATE INDEX IF NOT EXISTS "ai_credit_transactions_customerId_idx" ON "ai_credit_transactions"("customerId");
CREATE INDEX IF NOT EXISTS "ai_credit_transactions_walletId_idx" ON "ai_credit_transactions"("walletId");

CREATE UNIQUE INDEX IF NOT EXISTS "ai_generations_generationId_key" ON "ai_generations"("generationId");
CREATE INDEX IF NOT EXISTS "ai_generations_customerId_idx" ON "ai_generations"("customerId");
CREATE INDEX IF NOT EXISTS "ai_generations_type_idx" ON "ai_generations"("type");
CREATE INDEX IF NOT EXISTS "ai_generations_status_idx" ON "ai_generations"("status");
CREATE INDEX IF NOT EXISTS "ai_generations_deletedAt_idx" ON "ai_generations"("deletedAt");

CREATE INDEX IF NOT EXISTS "ai_generation_assets_generationId_idx" ON "ai_generation_assets"("generationId");

CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_customerId_platform_externalAccountId_key" ON "social_accounts"("customerId", "platform", "externalAccountId");
CREATE INDEX IF NOT EXISTS "social_accounts_customerId_idx" ON "social_accounts"("customerId");
CREATE INDEX IF NOT EXISTS "social_accounts_platform_idx" ON "social_accounts"("platform");
CREATE INDEX IF NOT EXISTS "social_accounts_isConnected_idx" ON "social_accounts"("isConnected");
CREATE INDEX IF NOT EXISTS "social_accounts_deletedAt_idx" ON "social_accounts"("deletedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "social_publishes_publishId_key" ON "social_publishes"("publishId");
CREATE INDEX IF NOT EXISTS "social_publishes_customerId_idx" ON "social_publishes"("customerId");
CREATE INDEX IF NOT EXISTS "social_publishes_socialAccountId_idx" ON "social_publishes"("socialAccountId");
CREATE INDEX IF NOT EXISTS "social_publishes_status_idx" ON "social_publishes"("status");
CREATE INDEX IF NOT EXISTS "social_publishes_scheduledFor_idx" ON "social_publishes"("scheduledFor");

-- AddForeignKeys
ALTER TABLE "influencer_packages" DROP CONSTRAINT IF EXISTS "influencer_packages_influencerId_fkey";
ALTER TABLE "influencer_packages" ADD CONSTRAINT "influencer_packages_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "influencers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_availabilities" DROP CONSTRAINT IF EXISTS "influencer_availabilities_influencerId_fkey";
ALTER TABLE "influencer_availabilities" ADD CONSTRAINT "influencer_availabilities_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "influencers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_bookings" DROP CONSTRAINT IF EXISTS "influencer_bookings_customerId_fkey";
ALTER TABLE "influencer_bookings" ADD CONSTRAINT "influencer_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_bookings" DROP CONSTRAINT IF EXISTS "influencer_bookings_influencerId_fkey";
ALTER TABLE "influencer_bookings" ADD CONSTRAINT "influencer_bookings_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "influencers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_bookings" DROP CONSTRAINT IF EXISTS "influencer_bookings_packageId_fkey";
ALTER TABLE "influencer_bookings" ADD CONSTRAINT "influencer_bookings_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "influencer_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "influencer_booking_payments" DROP CONSTRAINT IF EXISTS "influencer_booking_payments_bookingId_fkey";
ALTER TABLE "influencer_booking_payments" ADD CONSTRAINT "influencer_booking_payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "influencer_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_booking_payments" DROP CONSTRAINT IF EXISTS "influencer_booking_payments_customerId_fkey";
ALTER TABLE "influencer_booking_payments" ADD CONSTRAINT "influencer_booking_payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_portfolios" DROP CONSTRAINT IF EXISTS "influencer_portfolios_influencerId_fkey";
ALTER TABLE "influencer_portfolios" ADD CONSTRAINT "influencer_portfolios_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "influencers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_reviews" DROP CONSTRAINT IF EXISTS "influencer_reviews_influencerId_fkey";
ALTER TABLE "influencer_reviews" ADD CONSTRAINT "influencer_reviews_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "influencers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_reviews" DROP CONSTRAINT IF EXISTS "influencer_reviews_customerId_fkey";
ALTER TABLE "influencer_reviews" ADD CONSTRAINT "influencer_reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_credit_wallets" DROP CONSTRAINT IF EXISTS "ai_credit_wallets_customerId_fkey";
ALTER TABLE "ai_credit_wallets" ADD CONSTRAINT "ai_credit_wallets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_credit_transactions" DROP CONSTRAINT IF EXISTS "ai_credit_transactions_walletId_fkey";
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "ai_credit_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_credit_transactions" DROP CONSTRAINT IF EXISTS "ai_credit_transactions_customerId_fkey";
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_generations" DROP CONSTRAINT IF EXISTS "ai_generations_customerId_fkey";
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_generation_assets" DROP CONSTRAINT IF EXISTS "ai_generation_assets_generationId_fkey";
ALTER TABLE "ai_generation_assets" ADD CONSTRAINT "ai_generation_assets_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "ai_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_accounts" DROP CONSTRAINT IF EXISTS "social_accounts_customerId_fkey";
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_publishes" DROP CONSTRAINT IF EXISTS "social_publishes_customerId_fkey";
ALTER TABLE "social_publishes" ADD CONSTRAINT "social_publishes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_publishes" DROP CONSTRAINT IF EXISTS "social_publishes_socialAccountId_fkey";
ALTER TABLE "social_publishes" ADD CONSTRAINT "social_publishes_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_publishes" DROP CONSTRAINT IF EXISTS "social_publishes_generationId_fkey";
ALTER TABLE "social_publishes" ADD CONSTRAINT "social_publishes_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "ai_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
