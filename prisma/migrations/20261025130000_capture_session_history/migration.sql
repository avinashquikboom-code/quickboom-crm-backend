-- Existing sessions retain unknown status/counts; no historical data is rewritten.
ALTER TABLE "DataCaptureJob" ADD COLUMN "captureStatus" TEXT,
                             ADD COLUMN "foundResults" INTEGER;
