-- Complete missing CRM grants only for active employees whose persisted
-- department/designation relations explicitly qualify them as Sales Telecallers
-- with CRM mobile access enabled. Does not grant DELETE or admin permissions.
BEGIN;

INSERT INTO "Permission" (module, action, description, "updatedAt")
VALUES
  ('DATA_CAPTURE', 'VIEW', 'View authorized Data Capture records', CURRENT_TIMESTAMP),
  ('DATA_CAPTURE', 'CREATE', 'Search and capture Google Places records', CURRENT_TIMESTAMP),
  ('DATA_CAPTURE', 'EDIT', 'Edit and import authorized Data Capture records', CURRENT_TIMESTAMP),
  ('LEADS', 'VIEW', 'View authorized CRM leads', CURRENT_TIMESTAMP),
  ('LEADS', 'CREATE', 'Create leads from authorized CRM captures', CURRENT_TIMESTAMP),
  ('LEADS', 'EDIT', 'Update authorized CRM leads', CURRENT_TIMESTAMP)
ON CONFLICT (module, action)
DO UPDATE SET description = EXCLUDED.description, "updatedAt" = CURRENT_TIMESTAMP;

WITH eligible_roles AS (
  SELECT DISTINCT r.id AS "roleId"
  FROM "Employee" e
  JOIN "Department" d
    ON d.id = e."departmentId"
   AND d."customerId" = e."customerId"
  JOIN "Designation" des
    ON des.id = e."designationId"
   AND des."customerId" = e."customerId"
  JOIN "Role" r
    ON r."designationId" = des.id
   AND (r."customerId" = e."customerId" OR r."customerId" IS NULL)
  WHERE e.status = 'ACTIVE'
    AND e."mobileLoginEnabled" = TRUE
    AND des."crmMobileAccess" = TRUE
    AND upper(coalesce(d.name, '') || ' ' || coalesce(d.code, '')) LIKE '%SALES%'
    AND upper(coalesce(des.name, '') || ' ' || coalesce(des.code, '')) ~ '(TELECALL|TELESALES|TELESELL)'
    AND r."deletedAt" IS NULL

  UNION

  SELECT DISTINCT r.id AS "roleId"
  FROM "Employee" e
  JOIN "Department" d
    ON d.id = e."departmentId"
   AND d."customerId" = e."customerId"
  JOIN "Designation" des
    ON des.id = e."designationId"
   AND des."customerId" = e."customerId"
  JOIN "UserRole" ur ON ur."userId" = e."userId"
  JOIN "Role" r ON r.id = ur."roleId"
  WHERE e.status = 'ACTIVE'
    AND e."userId" IS NOT NULL
    AND e."mobileLoginEnabled" = TRUE
    AND des."crmMobileAccess" = TRUE
    AND upper(coalesce(d.name, '') || ' ' || coalesce(d.code, '')) LIKE '%SALES%'
    AND upper(coalesce(des.name, '') || ' ' || coalesce(des.code, '')) ~ '(TELECALL|TELESALES|TELESELL)'
    AND r."deletedAt" IS NULL
), required_permissions AS (
  SELECT p.id AS "permissionId"
  FROM "Permission" p
  WHERE (p.module, p.action) IN (
    ('DATA_CAPTURE', 'VIEW'), ('DATA_CAPTURE', 'CREATE'), ('DATA_CAPTURE', 'EDIT'),
    ('LEADS', 'VIEW'), ('LEADS', 'CREATE'), ('LEADS', 'EDIT')
  )
)
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT er."roleId", rp."permissionId"
FROM eligible_roles er
CROSS JOIN required_permissions rp
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;
