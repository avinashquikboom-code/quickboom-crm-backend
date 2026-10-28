# Lead pipeline visit filter and Visitor assignment fix

## Status and evidence

Implemented locally. Backend and Flutter fixture verification is recorded below.
**Verification against actual existing records in a signed-in test environment is pending. This is not a claim that the deployed issue is resolved.**

No authenticated QuickBoom test API/device session was supplied. The mobile app currently targets `https://api.qbapp.online/api/v1`; no credentials were extracted and no production scheduling, assignment, completion, repair, notification, or deployment was performed. Actual tenant stage IDs and the reported count of 17 have not been measured against that environment.

## Root causes

1. The previous Visit Scheduled repository lookup had a stage-matching `OR` and another tenant `OR` spread into the same object. JavaScript replaced the first with the second. The subsequent lead query consequently treated all tenant stages as Visit Scheduled. A read-only reproduction of the actual repository with synthetic records and `status=VISIT_SCHEDULED` returned `NEW`, `VISIT_SCHEDULED` and `VISIT_DONE`.
2. Stage filters also allowed legacy `status` to match even when a conflicting authoritative `stageId` existed. A lead could therefore be included under one filter while its card correctly displayed another stage.
3. Flutter used the configured stage key but did not send its configured numeric ID. Badge totals derived from a full-pipeline snapshot could subsequently be overwritten by search-result lengths or double-count a conflicting legacy status.
4. Visitor visibility could be granted by lead ownership or historical visits rather than the newest persisted visit assignment. Scheduling accepted missing assignments through fallback paths and did not enforce the selected Visitor's tenant.
5. Several mutation paths did not enforce the Visitor-only transition. The mobile visit GET path could synthesize visits, and visit ownership checks accepted lead ownership as an alternative to the actual visit assignee.

## Existing product semantics and field mapping

The existing pipeline tabs are **lead stages**, fetched from `GET /leads/stages`. Their numeric IDs are tenant-configured, not constants.

| UI/data | Authoritative source |
|---|---|
| All pipeline filter | No `stageId` or `status` parameter; existing authenticated visibility scope still applies |
| Specific stage tab | Configured `stage.id` sent as `stageId` on every page |
| Visit Scheduled | Stage whose configured key is `VISIT_SCHEDULED` (existing `VISIT` scheduling alias is retained) |
| Visit Done | Configured `VISIT_DONE` stage; `VISIT` is not treated as a Done alias |
| Card badge | Resolved `Lead.stageId` / `stage`, with status fallback when no stage is configured |
| Visit lifecycle | Persisted `Visit.status`: `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` |
| Visitor assignment | `Visit.employeeId`, an Employee database ID, not a User ID or display name |
| Scheduling date/time | `Visit.date` and `Visit.time` |
| API `visitStatus`, `visitScheduledAt`, `assignedVisitorId` | Response projections of the newest visit, not new database columns |

An explicit stage ID is authoritative. Legacy status fallback is limited to records with no `stageId`, so conflicting old status cannot override a real stage. No existing records are re-staged or repaired by this fix.

A **New-stage lead with a legitimate scheduled visit remains in New** in the stage pipeline; its visit is still Scheduled. It is not added to the Visit Scheduled *stage* tab merely to change its badge. The existing scheduling action itself already promotes a lead to Visit Scheduled; that behavior is preserved for new schedules. An assigned Visitor can access a legitimate active assigned visit even if a historical lead still has the New stage, but cannot use that mismatch to transition New directly to Visit Done.

Visitor pipeline visibility retains its existing active-visit queue scope: newest visit, assigned to the active authenticated Visitor, status Scheduled/In Progress. Completed visit history is available in the existing `/mobile/visits?tab=completed` view. General BPO/Admin Visit Done pipeline filtering uses the configured Done stage ID.

Badges retain their established definition: totals across the full accessible pipeline, independent of search text. Search can therefore show fewer records than the global stage badge. Stage changes refresh the full pipeline count snapshot. Pull-to-refresh retains the selected stage/search and reloads the snapshot. A search-result length never replaces the global total.

## API paths

- `GET /leads/stages`: authoritative stage configuration.
- `GET /leads?page=1&limit=50&stageId=<configured-id>&search=<optional>`: exact stage filter; the service carries identical criteria through all pages and deduplicates IDs.
- `GET /employees?status=ACTIVE&page=<n>&limit=100`: existing paginated employee source for the existing Visitor dropdown; no hardcoded IDs or names.
- `GET /leads/:id`: current lead and visit details.
- `POST /leads/:id/visits`: existing scheduling/start/completion action, with `employeeId`, `date` and `time` for scheduling.
- `PATCH /leads/:id/status`: existing permitted Visitor Visit Scheduled → Visit Done transition.
- `GET /mobile/visits` and existing detail/check-in/requirement/completion paths: strict persisted Visitor assignment checks. Visitor GET no longer creates substitute visits. Existing non-Visitor behavior is preserved.

Scheduling requires an explicit active, mobile-enabled Visitor in the same tenant, verified by the backend's existing designation/role rules. Visit and lead assignment/stage writes run in one transaction. Other lead fields and assignments are not repaired in bulk.

The Visitor-specific lead-action guard runs in addition to existing JWT, customer and permission guards. It blocks generic edits, reassignment, conversion, and other stage-changing lead actions. Authorized status changes still pass through ownership and exact transition checks. Assigned-visit check-in and completion retain their existing APIs. Requirement capture does not overwrite unrelated lead category/value fields for Visitor users.

The existing BPO scheduling callback reloads lead details and the pipeline; Visitor completion refreshes its filtered list. BPO details reload on app resume, and Admin uses persisted visit/lead data on its existing refresh. No new real-time transport or Admin UI was introduced.

## Files changed for this task

Backend (`quickboom-crm-backend/`):

- `src/modules/lead/lead.repository.ts`: authoritative stage filtering, current Visitor assignment visibility, separate visit response projections and transactional scheduling.
- `src/modules/lead/lead.service.ts`: ownership, active tenant-owned Visitor validation and exact transition restrictions.
- `src/modules/lead/lead.controller.ts`: pass authenticated user for conversion checks and attach the Visitor action guard.
- `src/modules/lead/lead.module.ts`: register the guard using existing repository injection.
- `src/modules/lead/visitor-lead-actions.guard.ts`: prevent bypasses through other lead mutation handlers without weakening existing guards.
- `src/modules/lead/dto/lead.dto.ts`: validate the existing visit action values.
- `src/modules/visit/mobile-visit.controller.ts`: restrict Visitor access to actual visit assignments; preserve independent visit status; skip synthesized visits during Visitor GET.
- `src/modules/lead/lead-visit-filter-assignment.spec.ts`: focused repository/service/guard regression tests using isolated fixtures.
- `docs/LEAD_PIPELINE_VISIT_FILTER_FIX.md`: this report.

Flutter (`QuickBoom-App-crm/`):

- `lib/shared/services/lead_service.dart`: send configured stage ID consistently across pages.
- `lib/shared/viewmodels/leads_viewmodel.dart`: synchronize stage queries/count snapshots, retain request generation checks, and refresh filtered lists after writes.
- `lib/shared/views/leads/leads_view.dart`: retain the selected stage ID alongside its key and preserve it on search/refresh; existing UI structure retained.
- `lib/shared/models/lead_model.dart`: parse visit metadata independently from the lead stage.
- `lib/roles/customer/widgets/schedule_visit_bottom_sheet.dart`: page through active employees using the existing API provider, require explicit Visitor selection and report fetch failures.
- `lib/shared/views/leads/lead_details_view.dart`: preserve the existing scheduling callback and remove the erroneous Visit-as-Done allowance.
- `test/leads_pipeline_filters_test.dart` and `test/leads_fetch_order_test.dart`: update test service overrides for the stage-ID parameter.
- `test/visit_pipeline_contract_test.dart`: actual Dio request/response parsing with controlled adapters and Flutter rendering/filter verification.

Existing uncommitted work in these files was preserved. Unrelated changes such as snack bars, Data Capture, prior BPO Visit UI additions and `docs/BPO_VISITOR_ASSIGNMENT_WORKFLOW.md` were not removed or replaced.

## Verification

Backend:

```sh
./node_modules/.bin/jest --runInBand --cacheDirectory=/tmp/qb-visit-fix/jest-cache src/modules/lead/lead-visit-filter-assignment.spec.ts
./node_modules/.bin/tsc --noEmit --incremental false
```

22 focused tests passed; backend TypeScript check passed. Tests cover all configured fixture stages, conflicting legacy status, New-stage scheduled visits, newest assignment isolation, tenant boundaries, search/pagination totals, explicit active Visitor selection, scheduling persistence and forbidden Visitor actions.

Flutter:

```sh
flutter test --no-pub test/visit_pipeline_contract_test.dart test/leads_pipeline_filters_test.dart test/leads_fetch_order_test.dart test/bpo_visitor_assignment_test.dart
flutter analyze --no-pub lib/shared/services/lead_service.dart lib/shared/models/lead_model.dart lib/shared/viewmodels/leads_viewmodel.dart lib/shared/views/leads/leads_view.dart lib/shared/views/leads/lead_details_view.dart lib/roles/customer/widgets/schedule_visit_bottom_sheet.dart test/visit_pipeline_contract_test.dart
```

26 focused tests passed; scoped analysis reported no issues. Tests verify configured IDs on every page, separate visit metadata, submitted assignment/date/time, rendered filter results, search, refresh, count semantics, rapid switching, stale responses, loading/empty/error states and the existing BPO Visits UI. The new display test initially failed because its `runAsync` drained unrelated unbundled Google Font loading; the test harness was corrected without adding/changing product fonts or assets.

Final checks after badge refresh adjustment are recorded in the completion report. `git diff --check` is restricted to task files so pre-existing unrelated whitespace changes are not altered.

## Before / after

Before: Visit Scheduled could include New/Done records, a search could change global badge totals, Visitor access could follow the wrong ownership field, and scheduling could use a fallback assignee.

After (local verified fixture paths): tabs use configured IDs and authoritative stages, pagination/search/refresh retain their query, global badges use refreshed full-pipeline data, scheduling persists the selected valid Visitor, and backend Visitor checks enforce assignment and the permitted transition.

## Remaining verification and deployment blockers

- Run read-only record checks and the BPO → Visitor → Done workflow in an identified signed-in non-production environment. Do not infer production success from mocked tests.
- Confirm the actual tenant stage IDs and the screenshot's count of 17 from authenticated responses.
- The app's configured remote API will not use local backend edits until the user performs their normal reviewed deployment. No deploy, server restart, environment/configuration change or infrastructure modification was performed by this task.
- No existing production records were used for write tests, so assignment/stage history and customer communications were preserved.

Prisma schema unchanged. No migration generated/applied. No Docker, CI/CD, `deploy.yml`, infrastructure or Admin Panel files changed. No commit, push, merge or deployment performed.
