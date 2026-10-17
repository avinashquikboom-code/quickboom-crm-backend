-- Read-only review queries. Not executed by this task.
SELECT to_regclass('public.crm_leads') AS new_lead_table,
       to_regclass('public."Lead"') AS legacy_lead_table;
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'DataCapturePlace'
AND column_name IN ('importedLeadId', 'isImported', 'status');
-- Legacy imported flags are not evidence that a real Lead exists; review them separately.
SELECT status, "isImported", count(*)
FROM "DataCapturePlace"
WHERE "deletedAt" IS NULL
GROUP BY status, "isImported";
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
ORDER BY started_at DESC LIMIT 10;
