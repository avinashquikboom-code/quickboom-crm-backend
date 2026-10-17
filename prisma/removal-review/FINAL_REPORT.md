# Customer / Lead removal result and migration review

Status: Customer/Lead schema cleanup and backend adaptation applied. Final integrated verification is BLOCKED by concurrent RBAC removal in the same checkout. This is not a deployment-ready completion claim.

The user directed removal of Customer and all customerId ownership. The resulting design is one organization. Tenant headers/claims do not select records; employee/team assignment and permission checks remain. No database migration, seed, production API, email or messaging operation was executed.

## 1–3. Models removed

Lead family: `Lead`, `LeadStatusHistory`, `LeadNote`, `LeadActivityTimeline`, `LeadReminder`, `LeadStage`, `RoleLeadLimit`, `EmployeeLeadLimit`.

Customer family: `Customer`, `CustomerSubscription`, `CustomerModuleOverride`, `CustomerMarketingVideoView`, `SubscriptionInstallment`, `CouponRedemption`, `CustomPlanOrder`.

15 models in total. Whole-table indexes and constraints disappear with their tables; see before.prisma and the SQL proposal for their complete definitions.

## 4–5. Relations removed

All direct Customer/Lead relations, inverse back-relations, named relations and links to deleted dependent models are removed from the intended schema. `changes.json` enumerates every removed field definition per retained model; `dependency-map.json` is the original complete relation graph.

No active Customer/Lead model, relation, customerId or leadId scalar remains in proposed-schema.prisma. Customer ownership also disappears from retained AI, social, influencer, marketing, commission and policy models. Customer subscription relations and subscriptionId fields disappear from Work, MonthlySchedule and PaymentHistory.

## 6. customerId fields removed from retained models

70 retained-model fields: `PaymentHistory.customerId`, `User.customerId`, `Role.customerId`, `Company.customerId`, `Contact.customerId`, `Pipeline.customerId`, `Deal.customerId`, `Task.customerId`, `Product.customerId`, `Quotation.customerId`, `Invoice.customerId`, `SupportTicket.customerId`, `Notification.customerId`, `AuditLog.customerId`, `FeatureToggle.customerId`, `EmployeeLocation.customerId`, `BranchGeofence.customerId`, `LocationTrackingSetting.customerId`, `Department.customerId`, `Designation.customerId`, `Employee.customerId`, `Attendance.customerId`, `LeaveType.customerId`, `LeaveRequest.customerId`, `PublicHoliday.customerId`, `EmployeeLeaveBalance.customerId`, `LeaveAdjustmentHistory.customerId`, `AttendancePolicy.customerId`, `LeavePolicy.customerId`, `SalaryPolicy.customerId`, `ClaimPolicy.customerId`, `RemoteRequest.customerId`, `Shift.customerId`, `ShiftGuidance.customerId`, `Visit.customerId`, `SalaryStructure.customerId`, `Payroll.customerId`, `PayrollItem.customerId`, `SalarySlip.customerId`, `PayrollPolicy.customerId`, `Team.customerId`, `PlanEntitlement.customerId`, `Work.customerId`, `DataCaptureJob.customerId`, `DataCapturePlace.customerId`, `DataCaptureSearch.customerId`, `EmployeeLoan.customerId`, `EmployeeClaim.customerId`, `MonthlySchedule.customerId`, `TrendingContent.customerId`, `MarketingBanner.customerId`, `MarketingVideo.customerId`, `SocialMediaHandler.customerId`, `RoleWorkPermission.customerId`, `WorkAccessRequest.customerId`, `EmployeeModuleOverride.customerId`, `InfluencerBooking.customerId`, `InfluencerBookingPayment.customerId`, `InfluencerReview.customerId`, `AiCreditWallet.customerId`, `AiCreditTransaction.customerId`, `AiGeneration.customerId`, `SocialAccount.customerId`, `SocialPublish.customerId`, `MasterItem.customerId`, `EmailTemplate.customerId`, `EmailLog.customerId`, `MetaTemplate.customerId`, `CommissionConfig.customerId`, `Commission.customerId`.

## 7. leadId fields removed from retained models

`Deal.leadId`, `Quotation.leadId`, `Visit.leadId`, `DataCapturePlace.importedLeadId`, `EmailLog.leadId`, `Commission.leadId`. Deleted-model fields disappear with the models. `DataCapturePlace.importedLeadId` is also removed.

## 8. Indexes removed/changed

Every removed or replacement retained-model index is listed below. Single-field tenant/Lead indexes disappear. Compound indexes retain useful non-domain fields; duplicate simplified indexes are deduplicated.

## 9. Unique constraints changed

For a single organization, department/designation/leave-type/shift codes, product SKU, employeeCode, feature flags, role work permissions, employee overrides, social account identity and master item keys become global. This preserves uniqueness protection. New global keys may collide across old tenants: preflight-read-only.sql contains checks; do not apply the proposal until those results are resolved. PostgreSQL default nullable-unique behavior remains; NULL-containing keys are not treated as equal.

`PayrollPolicy.customerId @unique` and `AiCreditWallet.customerId @unique` become `singletonKey String @unique @default("GLOBAL")`. Existing multiple policy/wallet rows must be explicitly consolidated before migration. No automatic consolidation or money transfer is performed.

MonthlySchedule loses the Customer/subscription/month/year unique key because subscription identity is removed. Distinct employee schedules may share a month; no incorrect global month/year uniqueness is introduced.

`Coupon.perCustomerLimit` and `Plan.leadLimit` are removed because their domains no longer exist.

### Exact retained-model constraint diff

- PaymentHistory:
  - Removed: `@@index([customerId])`
- User:
  - Removed: `@@index([customerId])`
- Role:
  - Removed: `@@index([customerId])`
- Company:
  - Removed: `@@index([customerId])`
- Contact:
  - Removed: `@@index([customerId])`
- Pipeline:
  - Removed: `@@index([customerId])`
- Deal:
  - Removed: `@@index([customerId])`
- Task:
  - Removed: `@@index([customerId])`
  - Removed: `@@index([customerId, deletedAt, createdAt])`
  - Added: `@@index([deletedAt, createdAt])`
- Product:
  - Removed: `@@unique([customerId, sku])`
  - Removed: `@@index([customerId])`
  - Added: `@@unique([sku])`
- Quotation:
  - Removed: `@@index([customerId])`
  - Removed: `@@index([leadId])`
- Invoice:
  - Removed: `@@index([customerId])`
- SupportTicket:
  - Removed: `@@index([customerId])`
- Notification:
  - Removed: `@@index([customerId])`
  - Removed: `@@index([customerId, createdAt])`
  - Added: `@@index([createdAt])`
- AuditLog:
  - Removed: `@@index([customerId])`
- FeatureToggle:
  - Removed: `@@unique([customerId, feature])`
  - Added: `@@unique([feature])`
- EmployeeLocation:
  - Removed: `@@index([customerId])`
- BranchGeofence:
  - Removed: `@@index([customerId])`
- LocationTrackingSetting:
  - Removed: `@@index([customerId])`
- Department:
  - Removed: `@@unique([customerId, code])`
  - Removed: `@@index([customerId])`
  - Added: `@@unique([code])`
- Designation:
  - Removed: `@@unique([customerId, code])`
  - Removed: `@@index([customerId])`
  - Added: `@@unique([code])`
- Employee:
  - Removed: `@@unique([customerId, employeeCode])`
  - Removed: `@@index([customerId])`
  - Added: `@@unique([employeeCode])`
- Attendance:
  - Removed: `@@index([customerId])`
  - Removed: `@@index([customerId, employeeId, date])`
  - Added: `@@index([employeeId, date])`
- LeaveType:
  - Removed: `@@unique([customerId, code])`
  - Removed: `@@index([customerId])`
  - Added: `@@unique([code])`
- LeaveRequest:
  - Removed: `@@index([customerId])`
- PublicHoliday:
  - Removed: `@@index([customerId])`
- EmployeeLeaveBalance:
  - Removed: `@@index([customerId])`
- LeaveAdjustmentHistory:
  - Removed: `@@index([customerId])`
- AttendancePolicy:
  - Removed: `@@index([customerId])`
- LeavePolicy:
  - Removed: `@@index([customerId])`
- SalaryPolicy:
  - Removed: `@@index([customerId])`
- ClaimPolicy:
  - Removed: `@@index([customerId])`
- RemoteRequest:
  - Removed: `@@index([customerId])`
- Shift:
  - Removed: `@@unique([customerId, code])`
  - Removed: `@@index([customerId])`
  - Added: `@@unique([code])`
- ShiftGuidance:
  - Removed: `@@index([customerId])`
- Visit:
  - Removed: `@@index([customerId])`
  - Removed: `@@index([leadId])`
- SalaryStructure:
  - Removed: `@@index([customerId])`
- Payroll:
  - Removed: `@@unique([customerId, month, year, departmentId])`
  - Removed: `@@index([customerId])`
  - Added: `@@unique([month, year, departmentId])`
- PayrollItem:
  - Removed: `@@index([customerId])`
- SalarySlip:
  - Removed: `@@index([customerId])`
- PayrollPolicy:
  - Removed: `@@index([customerId])`
- Team:
  - Removed: `@@index([customerId])`
- PlanEntitlement:
  - Removed: `@@index([customerId])`
- Work:
  - Removed: `@@index([customerId])`
  - Removed: `@@index([subscriptionId])`
  - Removed: `@@index([customerId, scheduledDate])`
  - Removed: `@@index([customerId, status])`
- DataCaptureJob:
  - Removed: `@@index([customerId])`
- DataCapturePlace:
  - Removed: `@@index([customerId])`
  - Removed: `@@index([customerId, deletedAt, createdAt])`
  - Added: `@@index([deletedAt, createdAt])`
- DataCaptureSearch:
  - Removed: `@@index([customerId])`
  - Removed: `@@index([customerId, employeeId])`
  - Removed: `@@index([customerId, employeeId, searchedAt])`
  - Added: `@@index([employeeId, searchedAt])`
- EmployeeLoan:
  - Removed: `@@index([customerId])`
- EmployeeClaim:
  - Removed: `@@index([customerId])`
- MonthlySchedule:
  - Removed: `@@unique([customerId, subscriptionId, month, year])`
  - Removed: `@@index([customerId])`
  - Removed: `@@index([subscriptionId])`
- TrendingContent:
  - Removed: `@@index([customerId, isActive, isPublished])`
  - Added: `@@index([isActive, isPublished])`
- MarketingBanner:
  - Removed: `@@index([customerId, isActive, isPublished])`
  - Added: `@@index([isActive, isPublished])`
- MarketingVideo:
  - Removed: `@@index([customerId, isActive, status])`
  - Added: `@@index([isActive, status])`
- SocialMediaHandler:
  - Removed: `@@index([customerId])`
- RoleWorkPermission:
  - Removed: `@@unique([customerId, roleName, workModule])`
  - Removed: `@@index([customerId])`
  - Added: `@@unique([roleName, workModule])`
- WorkAccessRequest:
  - Removed: `@@index([customerId])`
- EmployeeModuleOverride:
  - Removed: `@@unique([customerId, employeeId, moduleKey])`
  - Removed: `@@index([customerId])`
  - Added: `@@unique([employeeId, moduleKey])`
- InfluencerBooking:
  - Removed: `@@index([customerId])`
- InfluencerBookingPayment:
  - Removed: `@@index([customerId])`
- AiCreditWallet:
  - Removed: `@@index([customerId])`
- AiCreditTransaction:
  - Removed: `@@index([customerId])`
- AiGeneration:
  - Removed: `@@index([customerId])`
- SocialAccount:
  - Removed: `@@unique([customerId, platform, externalAccountId])`
  - Removed: `@@index([customerId])`
  - Added: `@@unique([platform, externalAccountId])`
- SocialPublish:
  - Removed: `@@index([customerId])`
- MasterItem:
  - Removed: `@@unique([type, code, customerId])`
  - Removed: `@@index([type, customerId])`
  - Added: `@@unique([type, code])`
  - Added: `@@index([type])`
- EmailTemplate:
  - Removed: `@@index([customerId])`
- EmailLog:
  - Removed: `@@index([customerId])`
  - Removed: `@@index([leadId])`
- MetaTemplate:
  - Removed: `@@index([customerId])`
- CommissionConfig:
  - Removed: `@@index([customerId])`
- Commission:
  - Removed: `@@index([customerId])`
  - Removed: `@@index([leadId])`
  - Removed: `@@index([tenantId, qualifyingAt])`
  - Added: `@@index([qualifyingAt])`

## 10. Named relations removed

`AssignedLeads`, `CreatedLeads`, `CustomerAssignedStaff`, `CustomerAssignedTeam`, `CustomerCreatedStaff`, `CustomerMobileRole`, `CustomerOriginLead`, `EmployeeLeads`.

## 11. Enums removed

`InstallmentStatus`, `LeadPriority`, `LeadStatus`, `SubscriptionStatus`. Shared enums remain.

## 12. Active modules preserved

Employee, departments, designations, teams, attendance, breaks, leave, payroll, employee overrides, Work/WorkTask/Task, employee calendars, visits, DataCaptureJob/DataCapturePlace/DataCaptureSearch, Company, Contact, Deal, Pipeline, Quotation, Invoice, generic PaymentHistory/receipts, Plan/Coupon/CouponPlan, PlanEntitlement, MonthlySchedule, Commission/CommissionShare, tickets, authentication tokens/sessions, generic email/templates, marketing, notifications, AI and social models remain in the intended schema.

MonthlySchedule supports Employee schedules; PaymentHistory supports commission purchase tracking; PlanEntitlement supports Work quotas. These are preserved because they have independent consumers. Work scheduling no longer requires a Customer subscription; explicit configured entitlements still enforce quotas. Removed-domain purchase endpoints return HTTP 410 rather than querying removed tables. Lead-only webhook/reminder behavior is retired. Generic notification delivery requires an explicit recipient userId; it does not guess an organization owner. Finance history/receipts use existing PAYMENTS permissions. New commission events require explicit seller attribution; historical commissions/shares/payroll settlement remain.

The startup schema repair routine that recreated Lead/Customer storage was removed. Deployment workflows and existing migration history were not edited. No application was started against the database.

## 13. Prisma verification

- Initial Customer/Lead-only active cleanup: format, validate and generate all passed (Prisma 5.19.0).
- Current review proposal preserving RBAC: format and validate pass. Offline migrate diff generated the SQL proposal.
- Later another process removed Role, Permission, UserRole, RolePermission and RoleType from the active schema and regenerated the shared client. This conflicts with the explicit preserve-RBAC scope. Active schema validation/regeneration must be repeated after that conflict is resolved; earlier successful validation does not validate the current concurrent state.

## 14. Backend build and targeted tests

The adapted backend reached zero TypeScript diagnostics before the concurrent RBAC/client changes. The final npm run build now FAILS because the generated client has no RoleType/role/userRole/userRoles, with cascading relation type errors. See backend-build.log. Five targeted no-database tests were added in src/prisma/customer-lead-removal.spec.ts, but the test suite is currently BLOCKED at TypeScript compilation by the same RBAC removals; zero tests executed. See targeted-tests.log. No success is claimed for current integrated validation.

## 15. Proposed destructive database migration

Review proposed-destructive-migration.sql. It is deliberately outside prisma/migrations and was generated from before.prisma to proposed-schema.prisma without database connectivity. It does not drop any RBAC table.

1. Back up and verify restore. Review read-only preflight results: duplicate new global keys, singleton records, actual PostgreSQL foreign keys and applied migration history. No target migration status was read in this task.
2. Decide how existing tenant data is to be combined in the single organization and reconcile wallet/policy rows. No automatic merging is proposed.
3. Drop incoming/outgoing foreign keys for deleted tables and removed columns first, including Customer/Lead cycles and references from retained models. The SQL enumerates schema-derived constraint names; compare those names against the live target.
4. Remove obsolete indexes and dependent columns/tables. All relevant foreign keys are dropped before table destruction, so dependent table order is safe without CASCADE. Drop the Lead family, Customer-only subscription/redemption/installment/order/override/view/limit storage and the Customer root. Retained modules keep their tables.
5. Drop only newly unused enum types, add the shared singleton keys, and create reviewed replacement global unique constraints/indexes.
6. Rehearse on a disposable restored database. Apply only after explicit user approval; no db push, migrate deploy/dev/reset or DROP was executed.

## 16. Remaining references and reasons

Every remaining matching line in the intended schema is recorded in remaining-schema-references.json and below. There are no deleted-model relations. Source keeps some legacy controller/decorator names, optional compatibility arguments, permission vocabulary, display labels and historical import metadata; these do not restore Prisma ownership. Existing tests/seeds/audits/migration history may still contain historical terminology and are not evidence of an active relation. The old migration files are intentionally immutable.

- Line 250: `type            ContactType            @default(CUSTOMER)` — Shared ContactType/DesignationAudience label retained for existing data; no Customer model relation.
- Line 638: `userRole     String? // CUSTOMER, EMPLOYEE, ADMIN, SUPER_ADMIN` — Historical actor label in an audit comment; no relation or identifier field.
- Line 827: `ledTeams                 Team[]                   @relation("TeamLeader")` — Team leadership or commission leadership; unrelated to the deleted Lead model.
- Line 1195: `customerName     String` — Visit free-text client name, independent of Customer identity and foreign keys.
- Line 1369: `leaderId    Int?` — Team leadership or commission leadership; unrelated to the deleted Lead model.
- Line 1373: `leader      Employee?    @relation("TeamLeader", fields: [leaderId], references: [id], onDelete: SetNull)` — Team leadership or commission leadership; unrelated to the deleted Lead model.
- Line 1377: `@@index([leaderId])` — Team leadership or commission leadership; unrelated to the deleted Lead model.
- Line 1594: `CUSTOMER_ADMIN` — Legacy stored RoleType enum label; shared role enum remains to preserve existing authorization records.
- Line 1613: `CUSTOMER` — Shared ContactType/DesignationAudience label retained for existing data; no Customer model relation.
- Line 1765: `CUSTOMER_REVIEW` — Existing shared WorkStatus enum label for an approval stage; no Customer relation.
- Line 2066: `CUSTOMER` — Shared ContactType/DesignationAudience label retained for existing data; no Customer model relation.
- Line 2638: `leaderId         Int?` — Team leadership or commission leadership; unrelated to the deleted Lead model.

## Concurrent workspace conflict

During this task an external process committed the intermediate edits as 9230218, then separately removed RBAC models and regenerated node_modules/.prisma/client. Those concurrent RBAC edits were not performed by this task and have not been overwritten. The review schema snapshots the intended Customer/Lead-only removal with RBAC intact. A clarification is pending about whether that independent RBAC removal is intentional. Finish integration only after resolving the competing edits.
