# Customer and Lead removal — pre-edit review

Status: active schema and backend unchanged pending tenant-isolation decision. No database commands executed.

## Proposed removals

- Lead, LeadStatusHistory, LeadNote, LeadActivityTimeline, LeadReminder, LeadStage, RoleLeadLimit, EmployeeLeadLimit.
- Customer, CustomerSubscription, CustomerModuleOverride, CustomerMarketingVideoView, SubscriptionInstallment, CouponRedemption, CustomPlanOrder.
- All fields whose relation target is a deleted model, their foreign key scalar fields, and corresponding indexes.
- All customerId fields, including scalar-only tenancy markers; all leadId and importedLeadId fields.

## Preserved independent dependencies

- Employee, Department, Designation, Team, attendance, leave, payroll, calendars, Work and tasks.
- DataCaptureJob, DataCapturePlace, DataCaptureSearch and extraction functionality.
- Plan, Coupon, CouponPlan; generic PaymentHistory is referenced by retained Commission purchase tracking.
- MonthlySchedule is used by Employee mobile schedules; preserve it and remove Customer/subscription links.
- PlanEntitlement is consumed by Work; preserve it without Customer ownership.
- Quotation, Deal, Visit, EmailLog, EmailTemplate, MetaTemplate, roles/permissions, sessions/tokens, tickets and notifications.
- AI, social publishing, influencer bookings/payments/reviews and marketing remain independent modules.

## Security decision required

Removing Customer ownership makes tenant-scoped records global unless a replacement organization boundary is implemented. This affects every model listed below with customerId, not only authentication. In particular it exposes payroll, location histories, captured business records, permission overrides, social account credentials and credit balances to incorrect scoping if guards/services are simply stripped.

Existing runtime evidence: common/guards/customer.guard.ts; modules/auth/auth.service.ts; modules/work/work.service.ts; modules/data-capture/data-capture.service.ts. 208 source files contain customerId, Customer/Lead delegates or Lead enums.

## Constraints requiring explicit semantics

For a single organization, codes/SKUs/employee codes and master keys can become globally unique after collision checks. PayrollPolicy and AiCreditWallet currently have one row per Customer; ownership or singleton semantics must be chosen rather than silently dropping uniqueness. Nullable compound keys need special attention: PostgreSQL permits repeated NULLs.

- LeadStage: `@@unique([customerId, key])`
- Product: `@@unique([customerId, sku])`
- FeatureToggle: `@@unique([customerId, feature])`
- Department: `@@unique([customerId, code])`
- Designation: `@@unique([customerId, code])`
- Employee: `@@unique([customerId, employeeCode])`
- LeaveType: `@@unique([customerId, code])`
- Shift: `@@unique([customerId, code])`
- Payroll: `@@unique([customerId, month, year, departmentId])`
- PayrollPolicy: `customerId          Int      @unique`
- MonthlySchedule: `@@unique([customerId, subscriptionId, month, year])`
- CustomerMarketingVideoView: `@@unique([customerId, marketingVideoId])`
- RoleWorkPermission: `@@unique([customerId, roleName, workModule])`
- EmployeeModuleOverride: `@@unique([customerId, employeeId, moduleKey])`
- RoleLeadLimit: `@@unique([customerId, roleName])`
- EmployeeLeadLimit: `@@unique([customerId, employeeId])`
- AiCreditWallet: `customerId   Int                   @unique`
- SocialAccount: `@@unique([customerId, platform, externalAccountId])`
- MasterItem: `@@unique([type, code, customerId])`

## Complete affected field inventory

### Customer

```prisma
leadLimit                Int                       @default(500)
customerType             String?                   @default("ENTERPRISE")
leadId                   Int?                      @unique
leads                    Lead[]
leadStages               LeadStage[]
moduleOverrides          CustomerModuleOverride[]
subscriptions            CustomerSubscription[]
marketingVideoViews      CustomerMarketingVideoView[]
roleLeadLimits           RoleLeadLimit[]
employeeLeadLimits       EmployeeLeadLimit[]
originLead               Lead?                     @relation("CustomerOriginLead", fields: [leadId], references: [id], onDelete: SetNull)
```

### Plan

```prisma
leadLimit        Int
subscriptions    CustomerSubscription[]
```

### CustomerSubscription

```prisma
customerId         Int
customLeadLimit    Int?
customer           Customer                  @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Coupon

```prisma
perCustomerLimit      Int                    @default(1)
subscriptions         CustomerSubscription[]
```

### CouponRedemption

```prisma
customerId       Int
customer         Customer             @relation(fields: [customerId], references: [id], onDelete: Cascade)
subscription     CustomerSubscription? @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
```

### PaymentHistory

```prisma
customerId     Int
customer       Customer                  @relation(fields: [customerId], references: [id], onDelete: Cascade)
subscription   CustomerSubscription?     @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
```

### User

```prisma
customerId              Int?
assignedLeads           Lead[]            @relation("AssignedLeads")
createdLeads            Lead[]            @relation("CreatedLeads")
leadNotes               LeadNote[]
customer                Customer?         @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Role

```prisma
customerId      Int?
customer        Customer?        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Permission

```prisma
customerOverrides CustomerModuleOverride[]
```

### Lead

```prisma
customerId           Int
status               LeadStatus             @default(NEW)
stage                LeadStage?             @relation(fields: [stageId], references: [id], onDelete: SetNull)
priority             LeadPriority           @default(MEDIUM)
customer             Customer               @relation(fields: [customerId], references: [id], onDelete: Cascade)
convertedCustomer    Customer?              @relation("CustomerOriginLead")
timeline             LeadActivityTimeline[]
notes                LeadNote[]
reminders            LeadReminder[]
statusHistory        LeadStatusHistory[]
```

### LeadStatusHistory

```prisma
leadId      Int
fromStatus  LeadStatus?
toStatus    LeadStatus
lead        Lead        @relation(fields: [leadId], references: [id], onDelete: Cascade)
```

### LeadNote

```prisma
leadId    Int
lead      Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
```

### LeadActivityTimeline

```prisma
leadId      Int
lead        Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
```

### LeadReminder

```prisma
leadId      Int
lead        Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
```

### LeadStage

```prisma
customerId  Int?
customer            Customer?      @relation(fields: [customerId], references: [id], onDelete: Cascade)
leads               Lead[]
```

### Company

```prisma
customerId    Int
customer      Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Contact

```prisma
customerId      Int
customer        Customer               @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Pipeline

```prisma
customerId Int
customer   Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Deal

```prisma
customerId      Int
leadId          Int?
customer        Customer      @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Task

```prisma
customerId        Int
customer          Customer      @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Product

```prisma
customerId     Int
customer       Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Quotation

```prisma
customerId  Int
leadId      Int?
customer    Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
lead        Lead?           @relation(fields: [leadId], references: [id])
```

### Invoice

```prisma
customerId   Int
customer     Customer                  @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### SupportTicket

```prisma
customerId   Int
customer     Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Notification

```prisma
customerId Int
customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### AuditLog

```prisma
customerId   Int?
customer     Customer? @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### FeatureToggle

```prisma
customerId Int
customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### EmployeeLocation

```prisma
customerId         Int
customer           Customer     @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### BranchGeofence

```prisma
customerId         Int
customer           Customer           @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### LocationTrackingSetting

```prisma
customerId       Int
customer         Customer                 @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Department

```prisma
customerId   Int
customer     Customer      @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Designation

```prisma
customerId   Int
customer     Customer    @relation(fields: [customerId], references: [id], onDelete: Cascade)
mobileCustomers Customer[] @relation("CustomerMobileRole")
```

### Employee

```prisma
customerId               Int
customer                 Customer                 @relation(fields: [customerId], references: [id], onDelete: Cascade)
leadLimit                EmployeeLeadLimit?
leads                    Lead[]                   @relation("EmployeeLeads")
assignedCustomers        Customer[]               @relation("CustomerAssignedStaff")
createdCustomers         Customer[]               @relation("CustomerCreatedStaff")
```

### Attendance

```prisma
customerId         Int
```

### LeaveType

```prisma
customerId         Int
```

### LeaveRequest

```prisma
customerId      Int
```

### PublicHoliday

```prisma
customerId  Int
customer    Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### EmployeeLeaveBalance

```prisma
customerId    Int
customer      Customer                 @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### LeaveAdjustmentHistory

```prisma
customerId       Int
customer         Customer              @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### AttendancePolicy

```prisma
customerId                 Int
customer                   Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### LeavePolicy

```prisma
customerId                  Int
customer                    Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### SalaryPolicy

```prisma
customerId                Int
customer                  Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### ClaimPolicy

```prisma
customerId                 Int
customer                   Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### RemoteRequest

```prisma
customerId      Int
```

### Shift

```prisma
customerId            Int
customer              Customer       @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### ShiftGuidance

```prisma
customerId               Int
customer                 Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Visit

```prisma
customerId       Int
leadId           Int?
customerName     String
lead             Lead?       @relation(fields: [leadId], references: [id])
```

### SalaryStructure

```prisma
customerId       Int
```

### Payroll

```prisma
customerId      Int
customer        Customer      @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### PayrollItem

```prisma
customerId       Int
```

### SalarySlip

```prisma
customerId      Int
```

### PayrollPolicy

```prisma
customerId          Int      @unique
customer            Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Team

```prisma
customerId  Int
leaderId    Int?
customer    Customer     @relation(fields: [customerId], references: [id], onDelete: Cascade)
leader      Employee?    @relation("TeamLeader", fields: [leaderId], references: [id], onDelete: SetNull)
assignedCustomers Customer[]   @relation("CustomerAssignedTeam")
```

### PlanEntitlement

```prisma
customerId   Int
customer     Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Work

```prisma
customerId     Int
customer       Customer              @relation(fields: [customerId], references: [id], onDelete: Cascade)
subscription   CustomerSubscription? @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
```

### DataCaptureJob

```prisma
customerId        Int
customer          Customer           @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### DataCapturePlace

```prisma
customerId     Int
importedLeadId   Int?
customer         Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### DataCaptureSearch

```prisma
customerId  Int
customer    Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### EmployeeLoan

```prisma
customerId       Int
customer         Customer   @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### EmployeeClaim

```prisma
customerId      Int
customer        Customer    @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### SubscriptionInstallment

```prisma
customerId        Int
customer          Customer             @relation(fields: [customerId], references: [id], onDelete: Cascade)
subscription      CustomerSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
```

### MonthlySchedule

```prisma
customerId         Int
customer         Customer              @relation(fields: [customerId], references: [id], onDelete: Cascade)
subscription     CustomerSubscription? @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
```

### CustomPlanOrder

```prisma
customerId       Int
customer     Customer              @relation(fields: [customerId], references: [id], onDelete: Cascade)
subscription CustomerSubscription? @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
```

### TrendingContent

```prisma
customerId    Int?
customer      Customer?        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### MarketingBanner

```prisma
customerId     Int?
customer       Customer? @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### MarketingVideo

```prisma
customerId     Int?
customer       Customer? @relation(fields: [customerId], references: [id], onDelete: Cascade)
views              CustomerMarketingVideoView[]
```

### CustomerMarketingVideoView

```prisma
customerId       Int
customer         Customer       @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### SocialMediaHandler

```prisma
customerId   Int
customer     Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### RoleWorkPermission

```prisma
customerId  Int
customer    Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### WorkAccessRequest

```prisma
customerId      Int
customer        Customer                @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### EmployeeModuleOverride

```prisma
customerId  Int
customer     Customer            @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### CustomerModuleOverride

```prisma
subjectCustomerId Int
subjectCustomer   Customer           @relation(fields: [subjectCustomerId], references: [id], onDelete: Cascade)
```

### RoleLeadLimit

```prisma
customerId   Int
customer     Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### EmployeeLeadLimit

```prisma
customerId   Int
customer     Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### InfluencerBooking

```prisma
customerId         Int
customer           Customer                   @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### InfluencerBookingPayment

```prisma
customerId    Int
customer      Customer          @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### InfluencerReview

```prisma
customerId   Int?
customer     Customer?  @relation(fields: [customerId], references: [id], onDelete: SetNull)
```

### AiCreditWallet

```prisma
customerId   Int                   @unique
customer     Customer              @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### AiCreditTransaction

```prisma
customerId      Int
customer        Customer       @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### AiGeneration

```prisma
customerId     Int
customer       Customer            @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### SocialAccount

```prisma
customerId            Int
customer              Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### SocialPublish

```prisma
customerId      Int
customer        Customer       @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### MasterItem

```prisma
customerId  Int?
customer    Customer? @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### EmailTemplate

```prisma
customerId         Int?
customer           Customer? @relation(fields: [customerId], references: [id], onDelete: Cascade)
leadStages         LeadStage[]
```

### EmailLog

```prisma
customerId        Int?
leadId            Int?
customer          Customer?      @relation(fields: [customerId], references: [id], onDelete: Cascade)
lead              Lead?          @relation(fields: [leadId], references: [id], onDelete: SetNull)
```

### MetaTemplate

```prisma
customerId         Int?
customer           Customer? @relation(fields: [customerId], references: [id], onDelete: Cascade)
leadStages         LeadStage[]
```

### CommissionConfig

```prisma
customerId      Int
customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
```

### Commission

```prisma
customerId       Int
leaderId         Int?
leadId           Int?
customer Customer        @relation(fields: [customerId], references: [id], onDelete: Cascade)
lead     Lead?           @relation(fields: [leadId], references: [id], onDelete: SetNull)
```

## Proposed migration order (review only)

1. Back up and test restore; verify actual PostgreSQL foreign keys and applied migration history on the target environment. This review derives from schema declarations, not live database inspection.
2. Resolve ownership/security, duplicate global keys, nullable compound keys and existing per-customer policy/wallet records before dropping any owner fields.
3. Drop every incoming and outgoing FK for deleted tables, and every FK using removed columns in retained tables. Include the Customer–Lead cycle and Commission.purchase/Work.subscription links where relevant.
4. Drop Lead children and limits, then Lead; drop customer subscription children/overrides/views and CustomerSubscription; drop Customer after all incoming FKs have been removed.
5. Drop deleted-domain FK columns from retained models, including subscriptionId and other dependency-specific IDs when their targets are deleted. Drop indexes/unique constraints that use those fields first.
6. Create reviewed replacement unique constraints and useful non-tenant indexes. Drop only enums with zero retained consumers.
7. Generate SQL from the old/new schema using Prisma migrate diff; inspect the SQL and compare against live FK inventory. Rehearse on a disposable restored database, then request approval before execution.

No migration SQL has been applied or registered. Existing migrations remain immutable. Prisma format/validate/generate against a changed schema and a post-change backend build are pending the ownership decision.

## Remaining references

All current Customer/Lead schema and source occurrences remain because this is a pre-edit dependency review. dependency-map.json lists every model relation (both removed-domain and independent relations) plus all matching fields. Migration history, old audit reports and tests are historical references and must not be mass-rewritten. Team leader/leaderId refers to team leadership, not the Lead domain. Shared enum values such as ContactType.CUSTOMER, RoleType.CUSTOMER_ADMIN and WorkStatus.CUSTOMER_REVIEW must be assessed separately from deleted model relations.

## Baseline verification

- Existing active Prisma schema: validate passed.
- Existing backend: npm run build passed.
- These are baseline results, not verification of a completed removal. No client regeneration or schema formatting was performed because the active schema was not changed.
- Only this review directory was added; application source, schema, database, migration history and deployment files remain unchanged.
