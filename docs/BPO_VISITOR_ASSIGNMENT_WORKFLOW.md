# BPO Mobile Visitor Assignment & Visit Done Workflow

## 1. Overview & Architecture

This document describes the end-to-end workflow for **Visitor Assignment by BPO Mobile** and the **Visit Done Lifecycle** in QuickBoom CRM across the backend NestJS service and Flutter mobile application:

$$\text{BPO Mobile} \xrightarrow{\text{Assign Visitor}} \text{Assigned Visitor Mobile} \xrightarrow{\text{Mark Visit Done}} \text{Admin Panel \& BPO Sync}$$

### Core Workflow Steps
1. **BPO Selects Visitor**: On the BPO mobile app (Lead Details / Schedule Visit sheet), BPO selects an active employee authorized for the Visitor role.
2. **Assign Visit & Lead**: Submitting the schedule visit form atomically creates the `Visit` record assigned to `employeeId`, updates the `Lead.employeeId`, sets `Lead.status = 'VISIT_SCHEDULED'`, and records a lead timeline event.
3. **Visitor Lead Visibility**: The assigned lead immediately appears in the assigned Visitor's mobile app under `/mobile/visits?tab=upcoming`. Unassigned visitors (Visitor B) are strictly prevented from seeing or interacting with Visitor A's leads or visits.
4. **Visitor Role Restrictions**: The Visitor role can only perform visit execution actions (check-in, capture requirements, complete visit). Visitors are prohibited from scheduling visits, reassigning employees, or moving leads to unrelated stages.
5. **Mark Visit Done**: When the visitor completes the visit, the backend updates `Visit.status = 'COMPLETED'`, transitions `Lead.status = 'VISIT_DONE'`, logs the completed event, and synchronizes status across Admin and BPO views.

---

## 2. API Contracts

### A. Schedule Visit & Assign Visitor
- **Endpoint**: `POST /api/v1/leads/:id/visits`
- **Auth**: Bearer JWT (`JwtAuthGuard`, `CustomerGuard`, `PermissionsGuard`)
- **Permissions**: BPO / Admin / Telecaller (`LEADS:EDIT` or `VISITS:CREATE`)
- **Request Body**:
  ```json
  {
    "action": "SCHEDULE",
    "employeeId": 14,
    "purpose": "Product Demonstration & Proposal",
    "date": "2026-10-30",
    "time": "11:00 AM",
    "location": "BKC Complex, Mumbai",
    "notes": "Client requested in-person software walkthrough"
  }
  ```
- **Backend Validation**:
  - Validates `employeeId` is provided.
  - Verifies employee exists and has `status: 'ACTIVE'`.
  - Verifies employee designation/role is authorized as a field visitor (`isVisitorEmployee`).
  - Blocks visitors from calling this endpoint (`ForbiddenException: Visitors cannot schedule or reassign visits`).
- **Response**: `200 OK`
  ```json
  {
    "statusCode": 200,
    "success": true,
    "message": "Visit scheduled successfully",
    "data": {
      "id": 84,
      "leadId": 987,
      "employeeId": 14,
      "status": "SCHEDULED",
      "purpose": "Product Demonstration & Proposal",
      "date": "2026-10-30T11:00:00.000Z",
      "time": "11:00 AM",
      "location": "BKC Complex, Mumbai",
      "notes": "Client requested in-person software walkthrough"
    }
  }
  ```

---

### B. Visitor Mobile Lead & Visit Listing
- **Endpoint**: `GET /api/v1/mobile/visits?tab=upcoming`
- **Auth**: Bearer JWT (`JwtAuthGuard`, `CustomerGuard`)
- **Isolation Scope**:
  - Field visitors are strictly scoped to `where: { employeeId: visitorEmployeeId }`.
  - Any attempt by Visitor B to query Visitor A's visits returns empty lists.
- **Response**: `200 OK`
  ```json
  {
    "statusCode": 200,
    "success": true,
    "data": {
      "visits": [
        {
          "id": 84,
          "leadId": 987,
          "leadName": "Star Tech Solutions",
          "contactPerson": "Rajiv Sharma",
          "phone": "+919876543210",
          "location": "BKC Complex, Mumbai",
          "purpose": "Product Demonstration & Proposal",
          "status": "SCHEDULED",
          "visitDate": "2026-10-30T11:00:00.000Z"
        }
      ]
    }
  }
  ```

---

### C. Visitor Complete Visit (Visit Done)
- **Endpoint**: `PATCH /api/v1/mobile/visits/:id/complete`
- **Auth**: Bearer JWT (`JwtAuthGuard`, `CustomerGuard`)
- **Backend Validation**:
  - Confirms authenticated visitor matches the visit's assigned `employeeId`.
  - Returns `403 Forbidden` if Visitor B attempts to complete Visitor A's visit.
- **Request Body**:
  ```json
  {
    "outcome": "POSITIVE",
    "notes": "Met with decision maker, agreed on standard tier proposal"
  }
  ```
- **Response**: `200 OK`
  - Updates `Visit.status = 'COMPLETED'` and `completedAt = new Date()`.
  - Transitions `Lead.status = 'VISIT_DONE'`.
  - Creates `LeadTimeline` entry recording visit completion.

---

## 3. Security & Permission Enforcement

| Action | Admin | BPO / Telecaller | Assigned Visitor | Unassigned Visitor |
| :--- | :---: | :---: | :---: | :---: |
| **Select & Assign Visitor** | Allowed | Allowed | Denied (403) | Denied (403) |
| **View Lead & Visit** | Allowed | Allowed | Allowed | Denied (Scoper Isolation) |
| **Check-in to Visit** | Denied (Field Only) | Denied | Allowed | Denied (403) |
| **Mark Visit Done** | Allowed | Denied (Field Only) | Allowed | Denied (403) |
| **Change Lead Stages** | Allowed | Allowed | Denied (`VISIT_DONE` only) | Denied |

---

## 4. Implementation Details

### Backend (`quickboom-crm-backend`)
1. **`src/modules/lead/lead.controller.ts`**:
   - Injected `@CurrentUser() user: any` into `manageVisit` to pass the calling user context down to the service layer for authorization verification.
2. **`src/modules/lead/lead.service.ts`**:
   - Enhanced `manageVisit`:
     - Checks if caller is a Visitor and rejects scheduling attempts with `ForbiddenException`.
     - Validates visitor selection when `action === 'SCHEDULE'`: ensures employee exists, `status === 'ACTIVE'`, and employee has visitor designation or role (`isVisitorEmployee`).
     - Atomically links visit and updates lead stage to `VISIT_SCHEDULED` and logs timeline.
3. **`src/modules/lead/lead.repository.ts`**:
   - Updated `isVisitorEmployee` to safely handle designations whether populated as strings, relation objects (`{ id, name, code }`), or role types.
4. **`src/modules/visit/mobile-visit.controller.ts`**:
   - Removed broad bypass filters (`!isVisitorUser` and `|| isVisitorUser`) that previously allowed any visitor to see all company visits.
   - Enforced strict 1:1 visitor scoping on `getMyVisits`, `getVisitById`, `checkIn`, `captureRequirement`, and `completeVisit`.

### Flutter Mobile (`QuickBoom-App-crm`)
1. **`lib/shared/models/lead_model.dart`**:
   - Added `List<LeadVisitModel> visits` with JSON deserialization and serialization.
   - Created `LeadVisitModel` representing scheduled visits (id, purpose, date, time, location, assignedEmployee, status, notes).
2. **`lib/shared/services/lead_service.dart` & `lib/shared/viewmodels/leads_viewmodel.dart`**:
   - Implemented `manageVisit(id, {action, employeeId, purpose, date, time, location, notes})` connecting to `POST /leads/:id/visits`.
3. **`lib/roles/customer/widgets/schedule_visit_bottom_sheet.dart`**:
   - Added BPO and CRM-eligibility access checks in `canSchedule`.
   - Filters active visitor employees via `queryParameters: {'status': 'ACTIVE'}`.
   - Mandatory validation: Blocks submission with an explicit message if no visitor is selected.
   - Prevents duplicate clicks during network requests via `_isSubmitting`.
4. **`lib/shared/views/leads/lead_details_view.dart`**:
   - Intercepts stage transition to `VISIT_SCHEDULED` and triggers `ScheduleVisitBottomSheet`.
   - Implemented `_buildVisitsTab` displaying scheduled visit cards with assigned visitor names, date/time, purpose, location, and notes.
   - Restricted Visitor role from selecting unrelated lead stages.

---

## 5. Verification & Testing

### Backend Unit Tests (`npm test -- src/modules/lead/bpo-visitor-assignment.spec.ts`)
- **12/12 Passed**:
  - `✓ successfully schedules visit and assigns lead to Visitor A`
  - `✓ rejects nonexistent employee ID`
  - `✓ rejects inactive employee`
  - `✓ rejects active employee who does not have Visitor role/designation`
  - `✓ visitor cannot schedule or reassign visits`
  - `✓ visitor cannot change lead stage to non-Visit-Done stages`
  - `✓ Visitor A receives their assigned scheduled visits`
  - `✓ Visitor B cannot see Visitor A lead or visit`
  - `✓ Visitor B cannot view Visitor A single visit details`
  - `✓ Visitor B cannot check-in to Visitor A visit`
  - `✓ Visitor B cannot complete Visitor A visit`
  - `✓ marks visit COMPLETED, updates lead to VISIT_DONE, and logs timeline`

### Flutter Mobile Tests (`flutter test`)
- **28/28 Passed**:
  - `test/bpo_visitor_assignment_test.dart` (LeadModel visit parsing, Visits tab empty state, scheduled visit card rendering)
  - `test/lead_details_and_social_media_test.dart`
  - `test/crm_pipeline_stages_test.dart`
  - `test/leads_pipeline_filters_test.dart`
- **`flutter analyze`**: 0 issues across all modified files.
- **Backend Build (`npm run build`)**: 0 TypeScript compilation errors.

---

## 6. Leads Pipeline Filter Resolution ("Visit Scheduled" showing "New" leads)

### Root Cause
When the mobile user tapped the **Visit Scheduled** filter chip, the backend repository (`lead.repository.ts`) constructed a query to locate the customer's Visit Scheduled stages using:
```ts
const visitStages = await this.prisma.leadStage.findMany({
  where: {
    OR: [
      { key: { in: ['VISIT_SCHEDULED', 'VISIT'] } },
      { name: { equals: 'Visit Scheduled', mode: 'insensitive' } },
    ],
    deletedAt: null,
    ...(where.customerId ? { OR: [{ customerId: where.customerId }, { customerId: null }] } : {}),
  },
  select: { id: true, key: true },
});
```
Due to JavaScript object key semantics, spreading `{ OR: [...] }` over an existing `OR` key completely overwrote the stage name/key condition. Consequently, `visitStages` returned **every stage** belonging to that customer (`[1, 2, 3, 4, 5, 6, 7, 8, ...]`).
When `stageIds` was populated with all stage IDs, the main lead query filtered by `{ stageId: { in: stageIds } }`, which matched **every lead in the database** (including newly captured leads with stage `1 New`).

### Fix Applied
1. **Backend (`lead.repository.ts` & `lead.service.ts`)**:
   - Encapsulated the conditions within Prisma's `AND: [ ... ]` array so the `key`/`name` condition is never overwritten by `customerId`.
   - Applied the fix to both `isVisitor` visit stage lookup (lines 782-805) and `isVisitScheduledFilter` lookup (lines 888-911).
2. **Flutter Mobile (`leads_view.dart`)**:
   - Implemented defensive client-side stage filtering for `displayLeads` so that selecting a stage filter guarantees only leads matching that stage key, status, or alias are rendered in the list.

