# New Lead workflow

Implemented a new single-organization Lead module, without restoring Customer, tenant IDs, Role, Permission, or configurable RBAC. This supersedes the earlier removal decision only for the Lead functionality explicitly requested in this task.

## APIs

All routes use the existing `/api/v1` prefix and JWT authentication.

- `POST /leads`: manually create a Lead. Requires companyName; optional contact/address/source fields are validated. Creator comes from the authenticated user. Defaults: source MANUAL, status NEW, deletedAt null, creation platform resolved by the existing platform helper.
- `GET /leads`: paginated, newest first (createdAt DESC, id DESC). All nondeleted sources are included by default; search/status/source/createdFrom filters apply only when supplied.
- `GET /leads/:id`: persisted Lead details.
- `POST /data-capture/:id/import-lead`: convert a VALIDATED capture using its stored fields. Returns `{ lead, record, alreadyImported }` within the existing API response envelope.

Administrators can access the organization Lead list. Active employees can access only Leads they created or are assigned to; employee imports assign the authenticated employee. Clients cannot choose the creator or set conversion links.

## Workflow and mapping

The actual Data Capture workflow fields are `status`, `isImported`, and the new `importedLeadId` foreign key. `businessStatus` remains independent Google Places business information.

`CAPTURED/PENDING/NEW -> VALIDATED -> LEAD_CREATED` is the conversion path. Rejected/unvalidated/deleted captures cannot be imported. Both list and drawer use `lib/data-capture-workflow.ts`. On import, the buttons show a spinner and block repeated clicks, then become View Lead when a persisted link is returned. Legacy imported flags without a link display Lead Imported without inventing a destination.

Stored field mapping:

| Capture | Lead |
| --- | --- |
| businessName | companyName |
| phone, email, website, address, category | same fields |
| googlePlaceId, latitude, longitude | same fields |
| notes | notes |
| rawData.firstName / first_name, lastName / last_name | firstName, lastName |
| rawData.city/state/country/pincode | city/state/country/pincode |
| rawData.addressComponents (locality, administrative_area_level_1/2, country, postal_code) | fallback structured location fields |
| import operation | source DATA_CAPTURE, status NEW, deletedAt null |
| authenticated request/platform | createdById, optional assignedToId, createdFrom |

Unknown location fields remain null; no guessing from a formatted address or placeholder business values is used. The Admin Axios client already sends x-client-type: admin, resolving imported Leads to ADMIN_PANEL.

## Duplicate and consistency protection

- Import locks the capture row in a database transaction.
- A linked Lead is returned on retry; the same capture cannot generate another Lead.
- Unique Google Place ID and a transaction-scoped advisory lock prevent duplicate business creation across captures. An accessible existing Lead is linked instead. Concurrent manual-create uniqueness conflicts return a retryable conflict rather than false success.
- Lead creation and capture linking/status update commit or roll back together.
- Deleted or inaccessible existing Leads cause explicit errors.
- General capture edits cannot forge isImported/LEAD_CREATED or undo final decisions. Conditional writes prevent an edit racing conversion from overwriting converted state. Bulk decisions exclude finalized/imported records.
- Legacy records marked imported without an actual link are not automatically repaired or duplicated. They require separate data review.

The old frontend 404 fallback that marked captures imported without creating a Lead is removed. No fake success or local-only Lead list insertion is used.

## Frontend integration

- Existing Data Capture page/API wrapper updated; list and drawer use the same workflow helper.
- New `/leads` page uses the existing Admin header/card/table/drawer/pagination components, React Query and Axios client. It lists manual and imported sources and supports manual creation.
- New `/leads/[id]` page reads the persisted Lead through the detail API.
- New `lib/leads-api.ts` defines the actual request/response types.
- Import invalidates `data-capture-list`, `data-capture-usage`, `data-capture-detail`, `leads` and the affected `lead` detail key. The selected capture refreshes without reopening its drawer.
- Manual creation invalidates the actual `leads` query and resets pagination to page 1. Explicit search/status filters remain respected.

## Schema and deployment boundary

The schema adds `Lead` mapped to the new `crm_leads` table, `CrmLeadStatus`, nullable `DataCapturePlace.importedLeadId`, and inverse User/Employee relations. The new table intentionally does not reuse an old legacy Lead table whose schema/migration state is unknown.

`additive-migration.sql` is an offline diff against the current checked-out schema, prepared for review only. `preflight-read-only.sql` provides deployed-schema and migration-history checks. Neither SQL file has been executed. No database records, applied migration history, seed, deployment workflow or deploy.yml file were changed.

Before deploying, reconcile the actual database with the expected single-organization schema, then separately review and apply the additive SQL. Do not run it blindly against a legacy database where importedLeadId may still reference an old Lead table. The earlier destructive removal proposals are historical and must not be treated as the final schema for this new feature.

## Verification

- Prisma format, validate and generate passed.
- Backend production build passed.
- Admin production build passed and includes `/leads` and `/leads/[id]`.
- 15 focused backend tests passed: field mapping including Google address components, real capture/Lead linkage, repeat import, five ineligible statuses, Google Place deduplication, failure propagation, legacy flag safety, employee ownership, manual defaults, and inclusion of manual/imported sources in the default list.
- Frontend workflow checks passed for normalized statuses, rejected/imported precedence and actual Lead links.

These checks used source/builds and isolated mocks. No live capture/import was performed, no real Lead ID was fabricated, and no production hard-refresh result is claimed. After the database transition is approved/applied, final manual verification should confirm a real imported Lead remains visible after browser refresh.
