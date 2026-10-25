# Commission split and empty-ledger audit — 2026-10-11

Status: implementation and automated verification completed for the code paths below. No production completion is claimed. The additive migration has not been applied by this task, and the real authenticated Admin page is not verified. Read-only local inspection confirms that the new schema fields/table are absent and that no attributed qualifying sale exists locally.

## Confirmed defects and record evidence

1. Admin response mapping: `lib/api.ts` returns the HTTP response body. The backend TransformInterceptor flattens the commission service response into `data: [rows]` with sibling `summary` and `meta`. The `/commissions` query returned `res.data`, discarding these siblings. The component then expected `commissionsRes.data`, `commissionsRes.summary` and `commissionsRes.meta` on that array, producing empty rows and zero fallback metrics even for a valid nonempty response. The query now validates/retains the complete ledger payload. Failed/malformed responses show an error, with unavailable totals instead of financial zeros.
2. Original commission generation paid the entire configured rate to one employee. It had no leader share or payroll reservation/settlement link. The existing configured event is successful qualifying plan payment, not WON alone. The existing schema supports percentage and fixed commission.
3. Original admin/self queries equated the purchasing customer's ID with the staff tenant ID. Converted customers have their own primary keys, so the correct tenant must come from sale attribution. New events snapshot tenant ID; legacy scope uses the purchasing tenant or origin lead tenant without modifying old rows.
4. The trusted successful-payment webhook path did not award commission. Qualifying persisted payments now dispatch to the same idempotent engine, retaining successful-payment policy. Refund dispatch uses signed webhook handling and immutable refund references.

Read-only local PrismaClient transactions, without Nest startup or service side effects, found:

- WON lead #83: tenant/customerId #1, assigned User #3; employeeId and convertedByEmployeeId null; convertedCustomer null.
- Zero customers with either a leadId or an assigned sale employee.
- Zero commission ledger rows and zero employee commission overrides.
- One successful payment, but no customer sale attribution that makes it a qualifying BPO sale.
- BPO team #1: tenant #1, leader #1 and sole member #1. A seller/leader self-pair is held for review rather than receiving both shares.
- No `commission_shares` table and no new tenantId/sourceKey columns in the inspected database.

These facts explain a genuinely empty ledger in the configured local environment. They do not establish the contents of a different production environment. No missing customer/seller ownership was guessed, no historical backfill ran, and no fake commission records were inserted.

## Split, visibility and payroll behavior

Persisted sale attribution takes priority over the current caller or customer creator. The engine checks BPO designation/department, active configuration, team membership and leader tenant/eligibility. It snapshots employee/team/leader, original configured value, base and earning timestamp. Missing/ambiguous attribution, self-leadership, or unverifiable historical rate/team changes create a held review event with no payable shares.

One source event retains the original configured total. It owns EMPLOYEE and LEADER recipient rows, each at half the rate/fixed value. Amounts use existing two-decimal rounding; the employee receives the rounded half and the leader the remaining paisa, so the sum cannot exceed the original rounded commission. Purchase uniqueness remains intact; a unique sourceKey also protects duplicate gateway transactions on multiple receipt rows. Event/role and event/recipient uniqueness prevent duplicate shares. Serializable creation handles concurrent retries. Previously created events, including historical unsplit paid commissions, are never regenerated or resplit.

Employee `/commissions/me` resolves identity from the authenticated user and returns only that recipient's ledger. `/commissions/team` returns only that leader's snapshotted leader shares, with source employee/customer and counterpart share details. Client employee/team IDs cannot widen these recipient queries. Admin sees tenant-scoped customer/source-employee events, original total and both recipients' statuses, payroll references and refund history. Metrics aggregate split share states plus legacy unsplit entries without counting a full event and its shares twice. Eligibility configuration reads do not mutate rates.

Mobile cards show customer ID, original/effective values, transaction amount versus commission base, customer totals, source seller for leader entries, payout status and payroll period. Paise are preserved. Pagination permits access beyond the initial page of own commissions and ignores stale filter/page responses.

Payroll reserves approved recipient shares for one payroll item in their earned business month (IST). Recalculation releases only that unfinalized batch's reservations and refuses a competing claim. Shares are added once to the correct employee's commission/gross/net snapshot; they are not attendance-prorated. Existing nonzero salary commission overlap requires review rather than automatic double compensation. Approval/generation cannot downgrade paid payroll, and finalized/paid calculation is protected. Settlement marks only reserved approved shares paid; repeat settlement does not change paid shares. Unpaid refunds cancel shares; partial refunds or paid reversals require review/authorized adjustment. History remains intact.

Offline receipt creation can precede approval: its successful approval update determines the earning timestamp, preventing commission from falling into the pending request month. Online captures retain the persisted capture receipt timestamp. Historical events retain their original snapshots.

## Files touched for this work

Backend:

- `prisma/schema.prisma`
- `prisma/migrations/20261011193000_bpo_commission_shares/migration.sql`
- `src/modules/commission/commission.service.ts`
- `src/modules/commission/commission.controller.ts`
- `src/modules/commission/commission-payroll.util.ts`
- `src/modules/commission/commission-engine.spec.ts`
- `src/modules/payment/payment.service.ts`
- `src/modules/payment/payment-commission-events.spec.ts`
- Commission integration in `src/modules/payroll/payroll.service.ts`, `payroll.spec.ts` and the attendance/payroll test fixture's empty commission-share delegate.

Admin:

- `app/(dashboard)/commissions/page.tsx`
- `lib/commission-ledger.ts`
- `tests/commission-ledger.test.cjs`

Flutter:

- `lib/roles/employee/models/commission_model.dart`
- `lib/roles/employee/viewmodels/commission_viewmodel.dart`
- `lib/roles/employee/views/commission_view.dart`
- `test/employee_commission_module_test.dart`

Other existing workspace payroll/attendance work was preserved; its unrelated changes are not attributed to this commission task.

## Migration and validation

The additive migration adds nullable event snapshots/review/history/source fields, allows a null employee for unresolved review events, and adds the recipient share table with unique constraints and payroll/employee/event foreign keys. It does not reset the database, drop existing tables, change existing commission amounts/statuses, or backfill paid history. Deploy it before the updated runtime uses the new fields. It has been generated and Prisma-validated, not live-applied or database-integration-tested here.

Verified automated example (synthetic fixtures, not a real customer payment): a successful ₹10,000 base at 3% produces ₹300 total, employee #10 receives 1.5%/₹150 and leader #20 receives 1.5%/₹150. The employee ledger reports only ₹150, then ₹150 paid after recipient payroll settlement; the leader's separate ₹150 remains approved until their settlement. Retried source events do not create another event. Tests also cover fixed/odd-paisa splits, attribution gaps, non-BPO exclusion, tenant/team access, refunds, historical snapshots and finalized payroll.

The Admin adapter tests retain a legitimate nonempty payload and its real totals, distinguish genuine empty payloads, and reject metadata loss/malformed responses. Final results: 8 backend suites / 95 tests passed; 11 mobile commission tests passed; 4 Admin adapter tests passed. Backend build, Admin TypeScript checks, targeted Flutter analysis, Prisma validation and diff checks passed. The mobile suite includes leader/customer mapping, pagination, currency precision and narrow-screen rendering.

An older live migration test selection failed to connect in the sandbox. Inspection showed that it deletes an existing employee's commission configuration; it was not retried against the shared database. No destructive cleanup or resets ran.

Actual page verification remains blocked: the browser inspection tool reported that computer-use permission is not granted, and no authenticated real Admin/employee API session was available. Local audit proves no attributed qualifying records, so there is no legitimate local commission to display/backfill. Production verification requires migration deployment, the affected environment/session and a real, correctly attributed successful BPO transaction; no production payout or appearance is claimed.
