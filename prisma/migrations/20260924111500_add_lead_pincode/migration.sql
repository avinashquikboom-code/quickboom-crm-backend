-- Safe Non-Destructive Migration: Add nullable pincode to Lead table
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "pincode" TEXT;
