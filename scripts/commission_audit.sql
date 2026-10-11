-- Read-only commission audit. Works before and after migration 20261011193000_bpo_commission_shares.
-- Usage: psql "$DATABASE_URL" -X -f scripts/commission_audit.sql
-- Output contains IDs, statuses, amounts and flags only (no names, emails or phones).
BEGIN TRANSACTION READ ONLY;

\echo '== 1. Existing commission rows, and rows hidden by the pre-fix admin filter (commission.customerId = admin tenant)'
SELECT c.status,
       count(*) AS rows,
       round(sum(c."commissionAmount")::numeric, 2) AS amount,
       count(*) FILTER (WHERE l."customerId" IS NOT NULL AND l."customerId" <> c."customerId") AS hidden_from_lead_tenant_admin
FROM commissions c
LEFT JOIN customers cu ON cu.id = c."customerId"
LEFT JOIN "Lead" l ON l.id = cu."leadId"
GROUP BY c.status
ORDER BY c.status;

\echo '== 2. Successful plan payments of lead-originated / seller-assigned customers, classified against eligibility'
WITH pay AS (
  SELECT p.id AS payment_id, p."customerId" AS customer_id, p."createdAt"::date AS paid_on,
         p.amount, p."taxAmount", p."totalAmount", p."paymentMethod",
         CASE
           WHEN p."transactionId" LIKE 'ADMIN-MANUAL-%' THEN 'admin_manual_activation'
           WHEN p."orderNumber" LIKE '#QB-CHG-%' THEN 'admin_plan_change'
           WHEN p."orderId" LIKE 'ORD-RNW-%' THEN 'admin_renewal'
           WHEN p."transactionId" LIKE 'INST-TXN-%' OR p."orderNumber" LIKE '#QB-INST-%' THEN 'installment'
           WHEN p."transactionId" LIKE 'NEW-TXN-%' OR p."orderNumber" LIKE '#QB-NEW-%' THEN 'installment_new_plan'
           WHEN p."transactionId" LIKE 'TXN-CP-%' THEN 'custom_plan'
           WHEN p."paymentMethod" = 'RAZORPAY' THEN 'razorpay'
           ELSE 'offline_or_other'
         END AS source,
         cu."leadId" AS lead_id, l."customerId" AS lead_tenant_id,
         COALESCE(l."convertedByEmployeeId", l."employeeId", cu."assignedEmployeeId", e_assigned.id) AS seller_id
  FROM "PaymentHistory" p
  JOIN customers cu ON cu.id = p."customerId"
  LEFT JOIN "Lead" l ON l.id = cu."leadId"
  LEFT JOIN "Employee" e_assigned ON e_assigned."userId" = l."assignedToId" AND e_assigned."customerId" = l."customerId"
  WHERE p.status = 'SUCCESS' AND p."deletedAt" IS NULL
    AND (cu."leadId" IS NOT NULL OR cu."assignedEmployeeId" IS NOT NULL)
)
SELECT pay.payment_id, pay.customer_id, pay.lead_id, pay.lead_tenant_id, pay.paid_on, pay.source,
       pay.amount, pay."taxAmount", pay.seller_id,
       e.status AS seller_status,
       (concat_ws(' ', d.name, dep.name) ~* '(bpo|telecall|telesales|teleseller|business process)') AS seller_is_bpo,
       d."commissionEnabled" AS designation_commission_enabled,
       d."commissionRate" AS designation_rate,
       cc.status AS employee_config_status,
       cc."commissionValue" AS employee_config_value,
       (SELECT count(*) FROM "TeamMember" tm JOIN "Team" t ON t.id = tm."teamId"
         WHERE tm."employeeId" = pay.seller_id AND t."isActive"
           AND concat_ws(' ', t.name, t.description) ~* '(bpo|telecall|telesales|business process)') AS bpo_team_count,
       (c.id IS NOT NULL) AS has_commission_row,
       c.status AS commission_status
FROM pay
LEFT JOIN "Employee" e ON e.id = pay.seller_id
LEFT JOIN "Designation" d ON d.id = e."designationId"
LEFT JOIN "Department" dep ON dep.id = e."departmentId"
LEFT JOIN commission_configs cc ON cc."employeeId" = e.id
LEFT JOIN commissions c ON c.purchase_id = pay.payment_id
ORDER BY pay.paid_on DESC, pay.payment_id DESC;

\echo '== 3. Summary of section 2 by payment source'
WITH pay AS (
  SELECT p.id,
         CASE
           WHEN p."transactionId" LIKE 'ADMIN-MANUAL-%' THEN 'admin_manual_activation'
           WHEN p."orderNumber" LIKE '#QB-CHG-%' THEN 'admin_plan_change'
           WHEN p."orderId" LIKE 'ORD-RNW-%' THEN 'admin_renewal'
           WHEN p."transactionId" LIKE 'INST-TXN-%' OR p."orderNumber" LIKE '#QB-INST-%' THEN 'installment'
           WHEN p."transactionId" LIKE 'NEW-TXN-%' OR p."orderNumber" LIKE '#QB-NEW-%' THEN 'installment_new_plan'
           WHEN p."transactionId" LIKE 'TXN-CP-%' THEN 'custom_plan'
           WHEN p."paymentMethod" = 'RAZORPAY' THEN 'razorpay'
           ELSE 'offline_or_other'
         END AS source
  FROM "PaymentHistory" p
  JOIN customers cu ON cu.id = p."customerId"
  WHERE p.status = 'SUCCESS' AND p."deletedAt" IS NULL
    AND (cu."leadId" IS NOT NULL OR cu."assignedEmployeeId" IS NOT NULL)
)
SELECT pay.source, count(*) AS payments, count(c.id) AS with_commission_row
FROM pay LEFT JOIN commissions c ON c.purchase_id = pay.id
GROUP BY pay.source ORDER BY payments DESC;

\echo '== 4. Designations with commission enabled'
SELECT d."customerId" AS tenant_id, d.id AS designation_id, d."commissionEnabled", d."commissionType", d."commissionRate",
       (d.name ~* '(bpo|telecall|telesales|teleseller|business process)') AS name_is_bpo
FROM "Designation" d
WHERE d."commissionEnabled" OR d."commissionRate" > 0
ORDER BY 1, 2;

ROLLBACK;
