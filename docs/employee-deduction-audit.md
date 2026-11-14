# Employee deduction implementation audit

This is an implementation audit, not an authorization to deduct pay. No employee deduction feature or policy has been enabled.

## Existing integration points

- `PayrollController` exposes `/admin/payroll` calculation, approval, generation, payment and slip endpoints, guarded by JWT, customer and permission guards. Explicit `SALARY` permissions are present on salary-target endpoints; verify the authorization behavior of each payroll endpoint before adding a deduction workflow.
- `PayrollService.calculatePayroll` selects active employees within `customerId`, calculates attendance, statutory, loan and other deductions, and persists payroll and items in a transaction. `SalaryStructure`, `Payroll`, `PayrollItem` and `SalarySlip` use Float amounts; `otherDeductions` is an aggregate and does not hold a reason, approval, or individual application history.
- `getSalarySlips` and `getSalarySlipById` use customer scope and employee identity for non-admin access. The employee Flutter application consumes these salary-slip APIs and renders existing aggregate fields. The admin maps the same API into its payroll and salary-slip screens.
- `NotificationService` and `FcmService` have employee-targeted notification patterns. New deduction notifications must be persisted and delivered only to the intended employee, with retry-safe delivery and a detail route.
- No employee penalty entity, deduction approval lifecycle, or payroll reversal/adjustment implementation was found in the payroll schema or service.

## Required decisions before an applicable deduction can be authorized

The governing jurisdictions and employer-approved policies must specify permitted deduction categories, eligibility, limits and calculations, employee notice/consent or opportunity to respond, approver roles and separation of duties, treatment of negative or insufficient net pay, time limits, payroll-period cutoffs and reversal/reimbursement procedure. These rules must be implemented as fail-closed tenant-specific policy, with a record of the policy and evidence used in each decision. A generic checkbox cannot establish compliance.

## Important payroll constraints

- Recalculation currently blocks `PAID` payroll but deletes and recreates payroll items for other statuses. Salary slips reference payroll items with cascading deletion. An itemized deduction cannot safely link to these items without redesigning recalculation and issued-slip immutability.
- Salary-slip generation updates an existing slip. An issued slip must not be silently rewritten when a deduction is applied or reversed; define the existing business distinction between generated and issued slips and add an auditable correction workflow.
- Department-scoped and company-wide payroll runs can overlap. Application uniqueness must be enforced at employee, tenant, deduction and payroll-period level, independently of batch ID and retries.
- Approval, payroll application, and correction must use transactional state transitions and concurrency controls. External notifications should be sent through an idempotent outbox after commit.
- Detail and PDF outputs need a shared persisted itemized snapshot so admin, mobile and downloaded slips cannot disagree. The existing slip download endpoint returns metadata rather than an actual PDF, and the admin has a client-side PDF fallback.

## Scope still to implement

Tenant-scoped decimal deduction and audit records; preview and eligibility evaluation; create, approve, reject, cancel, apply and reversal transitions; employee-only queries; notification history and push; admin and Flutter screens; itemized payroll, salary slips and PDF; migration and role/tenant/idempotency/concurrency tests. No new APIs or migrations were created during this audit.
