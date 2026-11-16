ALTER TABLE "lead_stage_whatsapp_deliveries" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "lead_stage_email_deliveries" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
