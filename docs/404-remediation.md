# Admin/Data Capture 404 remediation

## Findings and changes

1. The removed Lead Stages page was still advertised by `QuickBoom-Admin-Pannel-crm/lib/access-control.ts`. Removed its navigation item and the obsolete literal in `components/Sidebar.tsx`. No replacement page was created.
2. The removed Capture History page was still advertised by the same navigation config. Removed its navigation item and the obsolete sidebar literal. Data Capture and Usage & Quota remain available.
3. Production's public OpenAPI document at `https://api.qbapp.online/api/docs-json` exposes `POST /api/v1/data-capture/{id}/create-lead`, not `{id}/import-lead`. This matches the historical single-record controller contract. The Admin API wrapper now uses the actual `create-lead` route.
4. The deployed single-record response provides `place`; newer local responses provide `record`. The API wrapper normalizes those actual contracts and maps the capture timestamp from capturedAt or the persisted createdAt. A matching positive Lead ID/importedLeadId and true isImported flag are required; rejected responses are not accepted as success. HTTP errors propagate unchanged. There is no 404-to-PATCH fallback.
5. The current local controller supports both `:id/create-lead` and `:id/import-lead` through the same existing import method and service. No second conversion implementation was added. AppModule imports DataCaptureModule; DataCaptureModule registers DataCaptureController and imports LeadModule; main.ts supplies the api/v1 prefix.
6. Focused checks found missing validated-only and legacy-link safeguards in concurrently edited local import code. Restored the checks: nonvalidated records return 400; unavailable existing links or unverified prior-import flags return 409 instead of generating another Lead. Already-linked accessible Leads are returned idempotently. Rejected records remain blocked.

No `_rsc` handling was changed. No empty pages, placeholder data, alternate base URL, calendar/work changes, pagination changes or filter changes were introduced.

## Mapping and duplicate prevention

Existing conversion mapping remains in LeadService: businessName -> companyName; stored phone/email/website/address/category/Google Place ID/coordinates/notes are copied; structured rawData and Google address components provide location/name details. Source is DATA_CAPTURE, status uses CrmLeadStatus.NEW, creation platform comes from resolveCreatedFrom, and creator/employee context comes from authentication. No business IDs are hardcoded by this fix.

The local service retains capture row locking, a transaction-scoped Google Place advisory lock, the unique Google Place key, and persisted importedLeadId linking. It creates/links the Lead and changes capture state atomically. The UI keeps its single-flight guard, spinner, post-success View Lead action, and actual Data Capture/Lead query invalidations. No new local-only Lead list insertion is used.

## Verification

- Global search of Admin app/components/lib: no remaining links/references to `/master/lead-stages` or `/data-capture/history`.
- Frontend import-contract tests: 7 passed, covering the registered path, deployed/new response shapes, rejection of false conversion success and unchanged 400/404/409/500 error propagation.
- Backend route-registration + existing Lead workflow suites: 17 tests passed. The route test initializes the real controller with isolated service mocks and confirms both POST routes are mounted under api/v1 without connecting to a database or binding a test port.
- Backend and Admin production builds passed.
- Production public OpenAPI retrieval returned HTTP 200 and lists the existing create-lead route.
- An unauthenticated POST to that route with a nonexistent identifier and empty body returned HTTP 401, confirming a protected endpoint is available. No request was made to import record 3312, and no authenticated production mutation or live browser workflow was executed.

## Deployment status

The latest inspected backend Actions run for commit fc60adccc682a4d94beff4f063b8ad67de86f8d7 succeeded in building/pushing an image, but its steps do not contain a server deployment command:
https://github.com/avinashquikboom-code/quickboom-crm-backend/actions/runs/39008179836

The protected backend deploy.yml likewise adds an SSH key but never invokes backend.sh. It was not modified. The production API still exposes the existing conversion contract, so the frontend is aligned to that already-running endpoint rather than requiring a new backend endpoint to fix this 404.

These source changes have not been published/deployed by this task. The updated Admin build must be deployed before a browser stops using its old navigation/API URL. A full authenticated 200/201 import, Lead-list persistence after refresh, and browser Network verification remain final environment checks. No backend deployment, schema migration, production record mutation or deploy.yml edit was performed. The previously prepared new Lead-table migration still requires its separate schema review before deploying the newer backend; route compatibility does not apply that migration automatically.
