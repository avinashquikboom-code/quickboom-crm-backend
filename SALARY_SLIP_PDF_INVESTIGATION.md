# Salary slip PDF route investigation

## Confirmed cause

The Admin payroll modal navigated with `window.open('/api/v1/admin/payroll/slips/${id}/pdf')`. This uses the Admin origin rather than the configured API base. The token was read but unused; browser navigation does not attach the API client's Bearer or tenant headers. Next configuration has no API rewrite for this path.

A read-only request to the configured default running API, `https://api.qbapp.online`, independently confirms a deployment route mismatch:

- GET `/api/v1/admin/payroll/slips/109/pdf`: HTTP 404, application/json, nginx and backend security headers. Body explicitly says `Cannot GET /api/v1/admin/payroll/slips/109/pdf`. This is a route-level failure, not a missing salary-slip lookup.
- GET `/api/v1/admin/payroll/slips/109/download`: HTTP 401, JSON `Invalid or expired authentication token`.
- GET `/api/v1/admin/payroll/slips/109`: HTTP 401 with the same authentication rejection.

Source already registers both PDF and download aliases in PayrollController, PayrollModule is imported by AppModule, and main sets global prefix `api/v1`. No new route or migration is needed. The deployed download route is the compatible endpoint; local source's PDF alias is not present at the running default API.

## Changes for this task

Admin repository:
- `app/(dashboard)/payroll/page.tsx`: authenticated Download and View Official PDF actions, no direct relative navigation or print fallback.
- `lib/salary-slip-pdf.ts`: both actions reuse existing authenticated binary PDF helpers at `/admin/payroll/slips/:id/download` relative to configured API base. View opens the fetched PDF blob; Download saves it.
- `tests/salary-slip-pdf.test.cjs`: actual adapter execution with helper mocks, route encoding, and page wiring regression tests.

Backend repository:
- `src/modules/payroll/payroll.controller.ts`: SALARY VIEW permission on both existing binary aliases, in addition to existing JWT/customer/permission guards.
- `src/modules/payroll/payroll.service.ts`: close confirmed ownership gap where employees without embedded employee IDs bypassed the check. Resolve employee by authenticated user ID and slip tenant; reject missing/different ownership. Existing admin role utility retained for tenant admins.
- `src/modules/payroll/salary-slip-pdf.spec.ts`: registered routes/guards, permission/no-auth rejection, tenant-scoped lookup and JSON 404, employee ownership, real PDF bytes/length/disposition, and persisted historical amounts passed to renderer.
- This report.

Other concurrent payroll payment changes visible in the workspace are outside this task and were preserved.

## Persisted content and validation

The existing renderer is reused. Numeric salary-slip lookup loads persisted salarySlip and payrollItem/payroll, not current salary structures. Formatting uses persisted earnings, deductions, commission, net amounts and existing attendance calculation snapshots. The PDF includes identity, period, earnings/deductions and attendance summary where supported; this change does not calculate, approve, pay, generate or update any salary record. Existing active-* previews remain separate from persisted numeric slips.

The binary service returns application/pdf, Content-Length and an attachment filename. Inline viewing is provided securely by the authenticated blob viewer. Missing/tenant-filtered records return JSON 404; unresolved/different employee returns JSON 403; the JWT guard rejects unauthenticated requests with 401.

Verification:
- Backend payroll: 5 Jest suites / 60 tests passed.
- Admin adapter/page regression: 3 node tests passed.
- Backend `npm run build`: passed.
- Admin `npx tsc --noEmit --incremental false`: passed.
- Both repositories `git diff --check`: passed.

## Remaining verification block

No authenticated Admin session for the affected running environment is available. The tests use isolated in-memory fixtures, not inserted salary slips. They do not prove real slip 109 exists or has the expected historical values. Its authenticated PDF response, content, View and Download behavior remain unverified. No local app startup, migration, database reset, record fabrication or historical salary mutation was performed. Deploying the frontend fix and backend permission tightening is not claimed complete.
