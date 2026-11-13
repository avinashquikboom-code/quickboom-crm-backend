-- Idempotent: grant VISITS:CREATE / VISITS:VIEW / LEADS:SCHEDULE_VISIT to BPO & Telecaller roles.
-- Does not touch Visitor roles. Safe to re-run.

INSERT INTO "Permission" ("module", "action", "description", "createdAt", "updatedAt")
VALUES
    ('VISITS', 'CREATE', 'Schedule field visits for leads', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('VISITS', 'VIEW', 'View scheduled and completed field visits', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('LEADS', 'SCHEDULE_VISIT', 'Schedule a field visit from a lead', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("module", "action") DO UPDATE
SET "description" = EXCLUDED."description",
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."deletedAt" IS NULL
  AND UPPER(COALESCE(r.name, '')) ~ '(BPO|TELECALL|TELE_CALL|TELESALES|TELE_SALES|TELESELL)'
  AND NOT (UPPER(COALESCE(r.name, '')) ~ 'VISITOR')
  AND (
    (UPPER(p.module) = 'VISITS' AND UPPER(p.action) IN ('CREATE', 'VIEW'))
    OR (UPPER(p.module) = 'LEADS' AND UPPER(p.action) = 'SCHEDULE_VISIT')
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Also attach to designation-linked roles whose designation name matches BPO / Telecaller
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "Role" r
INNER JOIN "Designation" d ON d.id = r."designationId"
CROSS JOIN "Permission" p
WHERE r."deletedAt" IS NULL
  AND UPPER(COALESCE(d.name, '') || ' ' || COALESCE(d.code, '')) ~ '(BPO|TELECALL|TELE_CALL|TELESALES|TELE_SALES|TELESELL)'
  AND NOT (UPPER(COALESCE(d.name, '') || ' ' || COALESCE(d.code, '')) ~ 'VISITOR')
  AND (
    (UPPER(p.module) = 'VISITS' AND UPPER(p.action) IN ('CREATE', 'VIEW'))
    OR (UPPER(p.module) = 'LEADS' AND UPPER(p.action) = 'SCHEDULE_VISIT')
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
