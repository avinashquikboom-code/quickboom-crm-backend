# Restricted WON calendar diagnostic

Run from the backend directory with its existing dependencies and securely configured `DATABASE_URL`:

```sh
node -r ts-node/register scripts/won-calendar-diagnostic.ts \
  --lead "$AFFECTED_LEAD_ID" --customer "$AFFECTED_CUSTOMER_ID" \
  --subscription "$AFFECTED_SUBSCRIPTION_ID" --employee "$EMPLOYEE_ID" \
  --team "$PRODUCTION_TEAM_ID" --tenant "$TENANT_ID" \
  --working-customer "$WORKING_CUSTOMER_ID" \
  --from "$CALENDAR_START_DATE" --to "$CALENDAR_END_DATE" \
  --mode calendar
```

All IDs are mandatory positive existing primary keys. Dates must be `YYYY-MM-DD`. Use `--mode assigned` only when the authenticated route uses `assignedOnly`; `calendar` models the `allTenantCustomers` route. Optional `--status` and `--work-type` accept existing calendar status/group and WorkType values. This script does not verify the authenticated user's CALENDAR module grant, permit employee/team query overrides, or call an API. Do not interpret a predicted result as authorization.

The script uses PrismaClient directly, a RepeatableRead transaction, PostgreSQL `SET TRANSACTION READ ONLY`, and a statement timeout. It never instantiates PrismaService, WorkService, WorkPermissionService, or Nest. Existing exported constants/pure functions are imported for category mapping; no service methods are called. No startup lifecycle, schedule generation, carry-forward, assignment synchronization, or data writes run. Errors suppress connection details. Output excludes names, emails, phones, titles, descriptions, credentials and tokens. Do not attach `.env` files or tokens to reports.

Missing explicit records block the report. Inconsistent tenant evidence stops before activity retrieval. Reads are limited to the two requested customers, the explicitly selected subscription, employee, team and their permission/relationship metadata. Work/MonthlySchedule rows pointing to another customer through the affected subscription are reported as relationship mismatches, with Work visibility withheld.

Customer has no dedicated tenant-ID column. The report lists evidence through originLead, assignedTeam, assignedEmployeeRel, createdByEmployeeRel and matching leads. This relational evidence is an investigation aid, not a new authorization policy.

WorkTask is returned nested inside its parent Work calendar item. Its own assignment can make that parent eligible; WorkTask is not emitted independently. The separate Task table produces standalone calendar items and uses Employee IDs in `employeeId` but User IDs in `assignedToId`. MonthlySchedule rows are monthly intervals, not individual deliverables. The report keeps all three representations separate.

Filter evaluation mirrors the current date-range service branches and records assignment/category override behavior. `designation` and `permissionActivity` are explanatory flags, not independent mandatory gates: current direct/team assignment branches can override them. `excludedBy` identifies modeled mandatory gates, while `predictedIncluded` describes the pre-sync/pre-carry-forward snapshot. The script deliberately does not reproduce the endpoint's write-capable side effects. It cannot guarantee the endpoint response without authenticated verification. If the production filter implementation changes, update and validate this diagnostic alongside it.

Do not automatically fix an ID mismatch or generate missing Work. First inspect the conversion/activation logs and existing records. Record expected IDs/dates, then compare the authenticated endpoint response and before/after stored records in the affected environment.

Exit codes: 0 report generated, 1 sanitized database failure, 2 invalid/missing arguments, 3 missing/inconsistent records. Test with:

```sh
node --test -r ts-node/register scripts/won-calendar-diagnostic.test.ts
```

These tests use synthetic fixtures only. They do not demonstrate production success.
