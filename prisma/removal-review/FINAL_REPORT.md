# Customer, Lead and RBAC removal — final review

The requested source/schema changes are implemented for one shared organization. Backend and Admin production builds pass; Prisma format/validate/generate pass; 12 focused backend tests pass; the two changed Flutter services pass focused analysis. No database migration, seed, production API request, email or notification was executed. Deployment requires a separately reviewed database transition.

## 1. Customer models removed

`Customer`, `CustomerSubscription`, `CustomerModuleOverride`, `CustomerMarketingVideoView`, `SubscriptionInstallment`, `CouponRedemption`, `CustomPlanOrder`.

## 2. Lead models removed

`Lead`, `LeadStatusHistory`, `LeadNote`, `LeadActivityTimeline`, `LeadReminder`, `LeadStage`, `RoleLeadLimit`, `EmployeeLeadLimit`.

## 3. RBAC models removed

`Role`, `Permission`, `UserRole`, `RolePermission`, `RoleWorkPermission`, `EmployeeModuleOverride`. Together with the Customer/Lead family, 21 models were removed; 97 of the original 118 models remain. CustomerModuleOverride belongs to both requested cleanup families and is counted once.

## 4. Relations, fields and enums

All Prisma Customer/Lead/customerId/leadId relations and all Role/Permission foreign keys, inverse relations and named relations are removed. The obsolete employee permission-change timestamp is removed. Deleted enums include RoleType, AccessOverrideType, InstallmentStatus, SubscriptionStatus, LeadStatus and LeadPriority. See [final-changes.json](final-changes.json) for every changed model definition, field, index and unique constraint; [dependency-map.json](dependency-map.json) preserves the original relation graph.

## 5. User and Designation

User, Employee, Designation, authentication and refresh sessions remain. Designation is independent of Role. A scalar `User.accountType` defaults to EMPLOYEE; existing administrators are preserved by the proposed migration's explicit backfill before dropping Role/UserRole. No public registration DTO can set this field. Job titles, names and client-supplied role claims do not grant administrator authority.

## 6. Single-organization constraints

Tenant compound uniqueness was reduced to retained business keys, with duplicate indexes removed. PayrollPolicy and AiCreditWallet use a unique GLOBAL singletonKey. Resolve cross-tenant duplicate codes/keys and explicitly consolidate multiple singleton records before considering migration. No automatic data repair or wallet transfer was performed. MonthlySchedule retains independent schedule rows rather than introducing incorrect global month/year uniqueness.

## 7. Backend RBAC removal

The role/permission seed and constants, table-backed guards/decorators, override utilities, permission assembly code, permission controllers and employee/work permission endpoints are removed. There are no active Prisma Role/Permission/UserRole/RolePermission/override delegate queries. Applied historical migrations are preserved.

Fixed AccountGuard/AccountTypes and WorkspaceAccessGuard/WorkspaceAction preserve administrator versus authenticated employee workspace boundaries without configurable RBAC tables. WorkRecordGuard validates recorded work/editor/task/team assignments and protects administrator approval/allocation actions. ScheduleAccessGuard restricts employee monthly schedule reads to the linked employee and reserves organization schedule management for administrators.

## 8. Authentication/session behavior

Password login still accepts email, phone and employee code. OTP expiry/attempt checks and password reset remain. Login/JWT/profile/token generation read accountType from the database; an old token claiming SUPER_ADMIN cannot promote an employee. Active employee status/mobile-login eligibility remains checked. Refresh requires a matching, unrevoked, unexpired persisted token and atomically consumes it during rotation. Missing sessions cannot fall back to an arbitrary user lookup. Response role/roleType/roles labels remain compatibility aliases for accountType, without role IDs or database Role relations.

## 9. Employee Calendar and My Work

Employee Calendar and My Work remain connected to WorkService. Visibility follows direct assignedToId, editorId, WorkTask.assignedToId, active team leadership and membership. Removed RoleWorkPermission records and designation activity types no longer hide actual assignments. Employee work lists apply the same assignment scope. Work, WorkTask, Employee, Team and their assignments remain. Designation-based suggestions for production team allocation remain business scheduling behavior, rather than an authorization matrix.

## 10. Organization/Customer Calendar and monthly schedules

MonthlySchedule, its Plan relation, assignedEmployee relation, calendar/list/detail/CRUD APIs and existing schedule records are retained. The former Customer domain is removed as explicitly authorized; organization calendar reads use shared organization records, with employee reads scoped to their assignment. Customer-labelled display fields can remain compatibility labels, not Customer table dependencies.

Plan-based generation is restored through authenticated `POST /schedules/generate-plan/:planId` with optional startDate, duration (1–120 months), assignedEmployeeId. It uses retained anchor-date interval arithmetic, active Plan/Employee validation, a Plan row lock and duplicate lookup. Repeating an identical request reuses schedules. Retired subscription IDs are never reinterpreted as Plan IDs. The old subscription cancellation path returns HTTP 410 instead of accidentally cancelling every future shared schedule.

## 11. Other retained modules

HRM, attendance, leave, payroll, Data Capture, generic tasks, teams, commissions, Plan/PlanEntitlement, generic PaymentHistory/receipts, marketing, AI and social modules remain. Customer/Lead-specific operations are retired explicitly rather than querying deleted models. Explicit-recipient notifications remain; removed Customer ownership is not replaced with an arbitrary recipient. Data Capture retains jobs/places/search usage and company/contact duplicate checks, without Lead import dependencies.

## 12. Admin UI

No Role/Permission management routes/pages were present in the current Admin checkout. The obsolete permission matrix defaults, checks, navigation permission metadata and login permission-fetch calls are removed. Existing sidebar layouts, screens and account/workspace routing remain. UI availability uses authenticated identity; server-side guards enforce record access. Browser notification permissions are unrelated and retained.

## 13. Flutter compatibility

Two service adapters were necessarily updated because Flutter Calendar/My Work still requested the removed permission endpoints. They now request /auth/me and expose fixed UI availability for authenticated active employees. Existing widget capability DTO names remain for compatibility; they confer no server authority. Mobile layouts were not redesigned. This is not a wholesale removal of unrelated legacy Customer/Lead mobile screens or every mobile permission DTO.

## 14. Migration review and existing data

[combined-schema.prisma](combined-schema.prisma) mirrors the final active schema. [combined-destructive-migration.sql](combined-destructive-migration.sql) is an OFFLINE schema diff outside prisma/migrations, prefixed with the accountType backfill. It drops the requested tables/columns and necessarily deletes those domains' data if eventually approved and executed. It has NOT been applied.

[combined-preflight-read-only.sql](combined-preflight-read-only.sql) inventories collision/singleton and FK/migration-history concerns. It has NOT been run. Verify actual deployed migration history, administrator backfill and all existing foreign keys against a backed-up database before approval. Historical proposed-schema.prisma, proposed-destructive-migration.sql and changes.json describe the earlier Customer/Lead-only proposal; the final combined artifacts supersede them. Snapshot SQL may include pre-existing shared-checkout schema drift; review final-changes.json against the actual deployment baseline.

## 15. Verification

- Prisma format, validate and generate: passed, offline/local tooling only.
- Backend `npm run build`: passed.
- Admin `npm run build`: passed, including Next's TypeScript validity check.
- Four focused backend suites: 12 tests passed. They cover independent work/workflow, quotas, active assignment targets, Data Capture behavior/error propagation, global employee code, stored account identity, inactive employees, missing refresh sessions, unassigned work rejection and idempotent plan schedules.
- Flutter analysis for the two modified services: no issues found.
- deploy.yml files: untouched.

No full legacy regression suite or live database/manual calendar workflow was run. Legacy tests for removed RBAC-only functionality were retired; remaining historical fixtures may still describe old tenant/role labels. User manual verification remains appropriate after an approved migration in a safe environment. Existing records and scheduling behavior were checked through schema/source review and mocks, not live production requests.

## 16. Remaining terminology and final searches

[final-reference-inventory.json](final-reference-inventory.json) records every remaining matching source/document/test line across backend, Admin and Flutter, with its location, matching terms and reason (excluding generated/dependency/build/review output). Remaining categories:

- Immutable SQL migration history and review/baseline artifacts documenting deleted schema.
- Synthetic legacy test fixtures and historical diagnostic scripts; old schema diagnostics must not run against the new schema.
- Compatibility role/roles/roleType response fields and static account/workspace routing; authority comes from stored accountType.
- Job/designation/business labels, TeamMember.role, AuditLog.userRole and CommissionShare.recipientRole. These are independent text fields with no Role foreign key.
- Device/browser notification/location permission terminology (LocationPermissionStatus, Notification.permission).
- Existing mobile capability/widget DTO names; the affected Calendar/My Work adapters no longer call permission APIs.

There are no Role, Permission, UserRole, RolePermission, RoleWorkPermission, EmployeeModuleOverride or CustomerModuleOverride model definitions, or orphan roleId/permissionId fields in the active schema. Admin production sources contain no hasPermission/default role permission matrix or calls to removed permission APIs.

## 17. Deployment boundary

Source/build work is complete. The database transition remains intentionally unapplied. Deploy code only together with a separately approved and verified database migration; otherwise the new schema/client and old database do not match. No claim is made that production has already been migrated or manually tested.
