# WON lead employee calendar investigation — 2026-10-11

Status: reported production failure is not reproduced or fixed. The configured local database does not contain an affected converted customer or production employee. No application change is justified by the available record comparison.

## Traced workflow

- Admin `app/(dashboard)/leads/page.tsx:1054` and `app/(dashboard)/leads/[id]/page.tsx:279` PATCH `/leads/:id/status`.
- `src/modules/lead/lead.controller.ts:317` calls `LeadService.updateStatus`; general updates use `LeadService.updateLead`.
- `src/modules/lead/lead.service.ts:1874` and `:1591` invoke `handleLeadWonCustomerConversion` after recognizing WON/CONVERTED. `LeadRepository.updateStatus` stores status and history.
- Conversion (`lead.service.ts:1924`) links `Customer.leadId` to the lead and uses the persisted `customer.id` for the customer login account. It resolves customer employee/team assignments and preserves existing nonempty assignments. It creates an inactive customer when no plan exists; conversion itself does not generate Work or MonthlySchedule rows.
- `SubscriptionService.createOrder`, `createOrActivateCustomerSubscription`, and `activateCustomerSubscription` call the existing scheduling services using the subscription/customer relationship. Custom plans use `CustomPlanService`.
- `ScheduleService.generateSchedulesForSubscription` stores MonthlySchedule intervals with `sub.customerId`, `sub.id`, and `sub.planId`. These are monthly intervals, separate from individual Work activities.
- `WorkService.generatePlanSchedules` derives deliverables from plan features, checks existing Work rows, and creates Work/WorkTask records with the persisted customer/subscription IDs and resolved production assignments. No generation logic was changed.
- `CustomerService.assignTeam` invokes `WorkService.syncCustomerTeamWorkAssignments`. Calendar reads also invoke this sync for assigned customers and may run carry-forward outside tests; an authenticated live read therefore requires attention to these existing side effects.
- `WorkController.getEmployeeCalendar` (`work.controller.ts:383`) resolves the authenticated employee and module permissions, then calls `WorkService.getEmployeeCalendar` (`work.service.ts:2583`). This reads Work and separate Task rows, using direct/customer/team relationships, designation categories, permissions, status and date filters. `WorkPermissionService.getAllowedActivityTypesForEmployee` and `calendar-query.util.ts` supply activity eligibility.
- Flutter `employee_calendar_viewmodel.dart` fetches the existing `/works/employee/calendar` endpoint.

## Read-only local database evidence

Prisma schema inspected first. Queries used PrismaClient directly; no application startup, database writes, resets, migrations, or schedule regeneration were performed.

| Record | Observed relationship |
| --- | --- |
| Lead 83 | WON, tenant/customerId 1, assignedToId 3, employeeId null, assignedTeam null, convertedCustomer null |
| Customer 1 | leadId null, assignedTeamId null; 25 Work rows, 4 subscriptions, 0 MonthlySchedule rows |
| Employee 1 | userId 2, customerId 1, ACTIVE, Telecaller, team 1 |
| Employee 2 | userId 3, customerId 1, ACTIVE, Field Visitor, no team memberships |

The local WON lead has no persisted converted customer. This is the first missing relationship in that local record, but its history does not establish why it is missing, and it is not the reported case of an existing converted customer with scheduled work. There is no affected customer to compare against customer 1 and no production employee to verify. Existing schedules for the reported customer remain unknown.

## Validation and changes

Only `src/modules/lead/lead-won-to-customer-login.spec.ts` changed: supplied the missing CustomerMobilePermissionService test provider so the existing suite can initialize. No production code or Prisma schema changed. No migration created.

Executed Jest with `--runInBand` for:

- lead-won-to-customer-login.spec.ts
- admin-lead-won-customers.spec.ts
- employee-designation-calendar.spec.ts
- customer-schedule-employee-visibility.spec.ts
- works-end-to-end-subscription-calendar.spec.ts
- employee-calendar-access.spec.ts

Final result: 6 suites, 62 tests passed. The initial run exposed a missing test provider and sandbox socket binding restriction; the provider was added and tests rerun outside the sandbox. The HTTP calendar test checks nonempty response data with mocked dependencies. This does not verify a real authenticated production employee or the reported customer's stored schedules.

## Required to finish

An environment containing the affected records, affected WON lead/customer and employee IDs, and an authenticated employee API session are needed. Compare the actual customer, subscription, Work, WorkTask, team membership and designation records before choosing a conversion mapping or query fix. Then test exact expected work IDs and dates, wrong designations, unrelated assignees and other tenants, and confirm no schedule changes or duplicates. Root cause and successful affected-customer API response are not yet confirmed.

## Continuation: restricted diagnostic

The user identified the business as **Reliance SMART Superstore**. An exact, case-insensitive lookup of Customer.name/companyName and Lead.title/companyName in the configured local database returned zero matching customers and zero matching leads. The lookup used PrismaClient directly inside a PostgreSQL read-only transaction. No substitute records or guessed IDs were used. This does not establish that the records are absent in the affected production environment.

Added `scripts/won-calendar-diagnostic.ts`, `scripts/won-calendar-diagnostic.test.ts`, and `scripts/WON_CALENDAR_DIAGNOSTIC.md`. The script requires explicit lead/customer/subscription/employee/team/tenant/working-customer IDs and a date range/route mode. It enforces read-only transactions, restricts selected fields, reports linkage and filter predictions, and avoids service instantiation or calls. Nested WorkTask and standalone Task records are distinguished. It flags assignment branches that can override category gates rather than silently changing existing business behavior.

No production root-cause fix or schema change was made. Migration: none. Purchasing, scheduling, dates, assignments and customer calendar behavior remain unchanged. The affected-versus-working comparison, precise failure regression and authenticated API IDs/dates remain blocked because the named records and environment/session are unavailable. Earlier six-suite/62-test results remain baseline evidence, not a new production verification.

Continuation validation: `node --test -r ts-node/register scripts/won-calendar-diagnostic.test.ts` passed all 6 diagnostic unit tests. Missing-argument CLI invocation exited 2 before connecting. `git diff --check` passed. No production-record diagnostic run was attempted with fabricated IDs.
