-- Read-only audit for an empty Employee Calendar / My Work.
-- Mirrors the deployed GET /works/employee/calendar query (allTenantCustomers path):
--   Work.status <> CANCELLED AND Work.customerId = Employee.customerId
--   AND that customer isActive AND deletedAt IS NULL (+ optional date window).
-- Usage: psql "$DATABASE_URL" -X -v emp_code='QB-EMP-018' -f scripts/employee_work_audit.sql
-- Output: IDs, statuses, counts and timestamps only (no names, emails, phones, hashes or tokens).
BEGIN TRANSACTION READ ONLY;

\echo '== 1. Employee and linked user (JWT resolves employee via User -> Employee.userId)'
SELECT e.id AS employee_id, e."employeeCode", e."userId", e."customerId" AS tenant_id, e.status,
       e."mobileLoginEnabled", e."designationId", e."updatedAt" AS employee_updated_at,
       u."isActive" AS user_active, u."deletedAt" AS user_deleted_at, u."updatedAt" AS user_updated_at,
       (SELECT count(*) FROM "Employee" e2 WHERE e2."userId" = e."userId") AS employees_on_same_user
FROM "Employee" e
LEFT JOIN "User" u ON u.id = e."userId"
WHERE e."employeeCode" = :'emp_code';

\echo '== 2. Tenant customer gate (inactive or deleted => calendar and My Work return [])'
SELECT c.id AS tenant_id, c."isActive", c."deletedAt", c."updatedAt" AS tenant_updated_at
FROM customers c
WHERE c.id = (SELECT "customerId" FROM "Employee" WHERE "employeeCode" = :'emp_code');

\echo '== 3. Funnel for the deployed query'
WITH emp AS (SELECT id, "userId", "customerId" FROM "Employee" WHERE "employeeCode" = :'emp_code')
SELECT
  (SELECT count(*) FROM "Work" w, emp WHERE w."customerId" = emp."customerId") AS tenant_works_total,
  (SELECT count(*) FROM "Work" w, emp WHERE w."customerId" = emp."customerId" AND w.status <> 'CANCELLED') AS after_status_filter,
  (SELECT count(*) FROM "Work" w JOIN customers c ON c.id = w."customerId", emp
     WHERE w."customerId" = emp."customerId" AND w.status <> 'CANCELLED' AND c."isActive" AND c."deletedAt" IS NULL) AS after_tenant_gate,
  (SELECT count(*) FROM "Work" w JOIN customers c ON c.id = w."customerId", emp
     WHERE w."customerId" = emp."customerId" AND w.status <> 'CANCELLED' AND c."isActive" AND c."deletedAt" IS NULL
       AND w."scheduledDate" >= DATE '2026-09-30' AND w."scheduledDate" < DATE '2026-11-03') AS after_oct_2026_window;

\echo '== 4. Work assigned to this employee anywhere, grouped by owning customer'
WITH emp AS (SELECT id, "userId", "customerId" FROM "Employee" WHERE "employeeCode" = :'emp_code')
SELECT w."customerId" AS work_customer_id, (w."customerId" = emp."customerId") AS is_employee_tenant,
       c."isActive" AS customer_active, (c."deletedAt" IS NOT NULL) AS customer_deleted,
       w.status, count(*) AS works, max(w."updatedAt") AS last_updated
FROM "Work" w
JOIN emp ON (w."assignedToId" IN (emp.id, emp."userId") OR w."editorId" IN (emp.id, emp."userId")
             OR EXISTS (SELECT 1 FROM "WorkTask" t WHERE t."workId" = w.id AND t."assignedToId" IN (emp.id, emp."userId")))
LEFT JOIN customers c ON c.id = w."customerId"
GROUP BY 1, 2, 3, 4, 5
ORDER BY works DESC;

\echo '== 5. Team memberships and led teams'
WITH emp AS (SELECT id FROM "Employee" WHERE "employeeCode" = :'emp_code')
SELECT 'member' AS kind, t.id AS team_id, t."customerId" AS team_tenant, t."isActive", tm."joinedAt", t."updatedAt"
FROM "TeamMember" tm JOIN "Team" t ON t.id = tm."teamId", emp WHERE tm."employeeId" = emp.id
UNION ALL
SELECT 'leader', t.id, t."customerId", t."isActive", NULL, t."updatedAt"
FROM "Team" t, emp WHERE t."leaderId" = emp.id;

\echo '== 6. What changed since yesterday on this tenant (works by status, updated after 2026-10-10 00:00 IST)'
WITH emp AS (SELECT "customerId" FROM "Employee" WHERE "employeeCode" = :'emp_code')
SELECT w.status, count(*) AS works_updated, min(w."updatedAt"), max(w."updatedAt")
FROM "Work" w, emp
WHERE w."customerId" = emp."customerId" AND w."updatedAt" >= TIMESTAMP '2026-10-09 18:30:00'
GROUP BY w.status ORDER BY 2 DESC;

ROLLBACK;
