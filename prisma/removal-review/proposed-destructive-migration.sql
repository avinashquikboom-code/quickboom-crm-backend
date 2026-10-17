-- REVIEW ONLY: destructive proposal; not registered as an automatic migration.
-- Do not execute without data backup, preflight review, and explicit approval.
-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_mobileRoleId_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_assignedEmployeeId_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_createdByEmployeeId_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_leadId_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_assignedTeamId_fkey";

-- DropForeignKey
ALTER TABLE "customer_subscriptions" DROP CONSTRAINT "customer_subscriptions_couponId_fkey";

-- DropForeignKey
ALTER TABLE "customer_subscriptions" DROP CONSTRAINT "customer_subscriptions_customerId_fkey";

-- DropForeignKey
ALTER TABLE "customer_subscriptions" DROP CONSTRAINT "customer_subscriptions_planId_fkey";

-- DropForeignKey
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_couponId_fkey";

-- DropForeignKey
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_customerId_fkey";

-- DropForeignKey
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_planId_fkey";

-- DropForeignKey
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentHistory" DROP CONSTRAINT "PaymentHistory_customerId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentHistory" DROP CONSTRAINT "PaymentHistory_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_stageId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "LeadStatusHistory" DROP CONSTRAINT "LeadStatusHistory_leadId_fkey";

-- DropForeignKey
ALTER TABLE "LeadNote" DROP CONSTRAINT "LeadNote_leadId_fkey";

-- DropForeignKey
ALTER TABLE "LeadNote" DROP CONSTRAINT "LeadNote_userId_fkey";

-- DropForeignKey
ALTER TABLE "LeadActivityTimeline" DROP CONSTRAINT "LeadActivityTimeline_leadId_fkey";

-- DropForeignKey
ALTER TABLE "LeadReminder" DROP CONSTRAINT "LeadReminder_leadId_fkey";

-- DropForeignKey
ALTER TABLE "lead_stages" DROP CONSTRAINT "lead_stages_customerId_fkey";

-- DropForeignKey
ALTER TABLE "lead_stages" DROP CONSTRAINT "lead_stages_emailTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "lead_stages" DROP CONSTRAINT "lead_stages_whatsappTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "Company" DROP CONSTRAINT "Company_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Pipeline" DROP CONSTRAINT "Pipeline_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_customerId_fkey";

-- DropForeignKey
ALTER TABLE "SupportTicket" DROP CONSTRAINT "SupportTicket_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_customerId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_customerId_fkey";

-- DropForeignKey
ALTER TABLE "FeatureToggle" DROP CONSTRAINT "FeatureToggle_customerId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeLocation" DROP CONSTRAINT "EmployeeLocation_customerId_fkey";

-- DropForeignKey
ALTER TABLE "BranchGeofence" DROP CONSTRAINT "BranchGeofence_customerId_fkey";

-- DropForeignKey
ALTER TABLE "LocationTrackingSetting" DROP CONSTRAINT "LocationTrackingSetting_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Department" DROP CONSTRAINT "Department_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Designation" DROP CONSTRAINT "Designation_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Employee" DROP CONSTRAINT "Employee_customerId_fkey";

-- DropForeignKey
ALTER TABLE "PublicHoliday" DROP CONSTRAINT "PublicHoliday_customerId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeLeaveBalance" DROP CONSTRAINT "EmployeeLeaveBalance_customerId_fkey";

-- DropForeignKey
ALTER TABLE "LeaveAdjustmentHistory" DROP CONSTRAINT "LeaveAdjustmentHistory_customerId_fkey";

-- DropForeignKey
ALTER TABLE "AttendancePolicy" DROP CONSTRAINT "AttendancePolicy_customerId_fkey";

-- DropForeignKey
ALTER TABLE "LeavePolicy" DROP CONSTRAINT "LeavePolicy_customerId_fkey";

-- DropForeignKey
ALTER TABLE "SalaryPolicy" DROP CONSTRAINT "SalaryPolicy_customerId_fkey";

-- DropForeignKey
ALTER TABLE "ClaimPolicy" DROP CONSTRAINT "ClaimPolicy_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_customerId_fkey";

-- DropForeignKey
ALTER TABLE "ShiftGuidance" DROP CONSTRAINT "ShiftGuidance_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Visit" DROP CONSTRAINT "Visit_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Payroll" DROP CONSTRAINT "Payroll_customerId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollPolicy" DROP CONSTRAINT "PayrollPolicy_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Team" DROP CONSTRAINT "Team_customerId_fkey";

-- DropForeignKey
ALTER TABLE "PlanEntitlement" DROP CONSTRAINT "PlanEntitlement_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Work" DROP CONSTRAINT "Work_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Work" DROP CONSTRAINT "Work_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "DataCaptureJob" DROP CONSTRAINT "DataCaptureJob_customerId_fkey";

-- DropForeignKey
ALTER TABLE "DataCapturePlace" DROP CONSTRAINT "DataCapturePlace_customerId_fkey";

-- DropForeignKey
ALTER TABLE "DataCaptureSearch" DROP CONSTRAINT "DataCaptureSearch_customerId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeLoan" DROP CONSTRAINT "EmployeeLoan_customerId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeClaim" DROP CONSTRAINT "EmployeeClaim_customerId_fkey";

-- DropForeignKey
ALTER TABLE "subscription_installments" DROP CONSTRAINT "subscription_installments_customerId_fkey";

-- DropForeignKey
ALTER TABLE "subscription_installments" DROP CONSTRAINT "subscription_installments_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "subscription_installments" DROP CONSTRAINT "subscription_installments_paymentHistoryId_fkey";

-- DropForeignKey
ALTER TABLE "subscription_installments" DROP CONSTRAINT "subscription_installments_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "monthly_schedules" DROP CONSTRAINT "monthly_schedules_customerId_fkey";

-- DropForeignKey
ALTER TABLE "monthly_schedules" DROP CONSTRAINT "monthly_schedules_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "custom_plan_orders" DROP CONSTRAINT "custom_plan_orders_customerId_fkey";

-- DropForeignKey
ALTER TABLE "custom_plan_orders" DROP CONSTRAINT "custom_plan_orders_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "trending_contents" DROP CONSTRAINT "trending_contents_customerId_fkey";

-- DropForeignKey
ALTER TABLE "marketing_banners" DROP CONSTRAINT "marketing_banners_customerId_fkey";

-- DropForeignKey
ALTER TABLE "marketing_videos" DROP CONSTRAINT "marketing_videos_customerId_fkey";

-- DropForeignKey
ALTER TABLE "customer_marketing_video_views" DROP CONSTRAINT "customer_marketing_video_views_customerId_fkey";

-- DropForeignKey
ALTER TABLE "customer_marketing_video_views" DROP CONSTRAINT "customer_marketing_video_views_marketingVideoId_fkey";

-- DropForeignKey
ALTER TABLE "social_media_handlers" DROP CONSTRAINT "social_media_handlers_customerId_fkey";

-- DropForeignKey
ALTER TABLE "role_work_permissions" DROP CONSTRAINT "role_work_permissions_customerId_fkey";

-- DropForeignKey
ALTER TABLE "work_access_requests" DROP CONSTRAINT "work_access_requests_customerId_fkey";

-- DropForeignKey
ALTER TABLE "employee_module_overrides" DROP CONSTRAINT "employee_module_overrides_customerId_fkey";

-- DropForeignKey
ALTER TABLE "customer_module_overrides" DROP CONSTRAINT "customer_module_overrides_subjectCustomerId_fkey";

-- DropForeignKey
ALTER TABLE "customer_module_overrides" DROP CONSTRAINT "customer_module_overrides_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "role_lead_limits" DROP CONSTRAINT "role_lead_limits_customerId_fkey";

-- DropForeignKey
ALTER TABLE "employee_lead_limits" DROP CONSTRAINT "employee_lead_limits_customerId_fkey";

-- DropForeignKey
ALTER TABLE "employee_lead_limits" DROP CONSTRAINT "employee_lead_limits_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "influencer_bookings" DROP CONSTRAINT "influencer_bookings_customerId_fkey";

-- DropForeignKey
ALTER TABLE "influencer_booking_payments" DROP CONSTRAINT "influencer_booking_payments_customerId_fkey";

-- DropForeignKey
ALTER TABLE "influencer_reviews" DROP CONSTRAINT "influencer_reviews_customerId_fkey";

-- DropForeignKey
ALTER TABLE "ai_credit_wallets" DROP CONSTRAINT "ai_credit_wallets_customerId_fkey";

-- DropForeignKey
ALTER TABLE "ai_credit_transactions" DROP CONSTRAINT "ai_credit_transactions_customerId_fkey";

-- DropForeignKey
ALTER TABLE "ai_generations" DROP CONSTRAINT "ai_generations_customerId_fkey";

-- DropForeignKey
ALTER TABLE "social_accounts" DROP CONSTRAINT "social_accounts_customerId_fkey";

-- DropForeignKey
ALTER TABLE "social_publishes" DROP CONSTRAINT "social_publishes_customerId_fkey";

-- DropForeignKey
ALTER TABLE "master_items" DROP CONSTRAINT "master_items_customerId_fkey";

-- DropForeignKey
ALTER TABLE "email_templates" DROP CONSTRAINT "email_templates_customerId_fkey";

-- DropForeignKey
ALTER TABLE "email_logs" DROP CONSTRAINT "email_logs_customerId_fkey";

-- DropForeignKey
ALTER TABLE "email_logs" DROP CONSTRAINT "email_logs_leadId_fkey";

-- DropForeignKey
ALTER TABLE "meta_templates" DROP CONSTRAINT "meta_templates_customerId_fkey";

-- DropForeignKey
ALTER TABLE "commission_configs" DROP CONSTRAINT "commission_configs_customerId_fkey";

-- DropForeignKey
ALTER TABLE "commissions" DROP CONSTRAINT "commissions_customerId_fkey";

-- DropForeignKey
ALTER TABLE "commissions" DROP CONSTRAINT "commissions_leadId_fkey";

-- DropIndex
DROP INDEX "PaymentHistory_customerId_idx";

-- DropIndex
DROP INDEX "User_customerId_idx";

-- DropIndex
DROP INDEX "Role_customerId_idx";

-- DropIndex
DROP INDEX "Company_customerId_idx";

-- DropIndex
DROP INDEX "Contact_customerId_idx";

-- DropIndex
DROP INDEX "Pipeline_customerId_idx";

-- DropIndex
DROP INDEX "Deal_customerId_idx";

-- DropIndex
DROP INDEX "Task_customerId_idx";

-- DropIndex
DROP INDEX "Task_customerId_deletedAt_createdAt_idx";

-- DropIndex
DROP INDEX "Product_customerId_idx";

-- DropIndex
DROP INDEX "Product_customerId_sku_key";

-- DropIndex
DROP INDEX "Quotation_customerId_idx";

-- DropIndex
DROP INDEX "Quotation_leadId_idx";

-- DropIndex
DROP INDEX "Invoice_customerId_idx";

-- DropIndex
DROP INDEX "SupportTicket_customerId_idx";

-- DropIndex
DROP INDEX "Notification_customerId_idx";

-- DropIndex
DROP INDEX "Notification_customerId_createdAt_idx";

-- DropIndex
DROP INDEX "AuditLog_customerId_idx";

-- DropIndex
DROP INDEX "FeatureToggle_customerId_feature_key";

-- DropIndex
DROP INDEX "EmployeeLocation_customerId_idx";

-- DropIndex
DROP INDEX "BranchGeofence_customerId_idx";

-- DropIndex
DROP INDEX "LocationTrackingSetting_customerId_idx";

-- DropIndex
DROP INDEX "Department_customerId_idx";

-- DropIndex
DROP INDEX "Department_customerId_code_key";

-- DropIndex
DROP INDEX "Designation_customerId_idx";

-- DropIndex
DROP INDEX "Designation_customerId_code_key";

-- DropIndex
DROP INDEX "Employee_customerId_idx";

-- DropIndex
DROP INDEX "Employee_customerId_employeeCode_key";

-- DropIndex
DROP INDEX "Attendance_customerId_idx";

-- DropIndex
DROP INDEX "Attendance_customerId_employeeId_date_idx";

-- DropIndex
DROP INDEX "LeaveType_customerId_idx";

-- DropIndex
DROP INDEX "LeaveType_customerId_code_key";

-- DropIndex
DROP INDEX "LeaveRequest_customerId_idx";

-- DropIndex
DROP INDEX "PublicHoliday_customerId_idx";

-- DropIndex
DROP INDEX "EmployeeLeaveBalance_customerId_idx";

-- DropIndex
DROP INDEX "LeaveAdjustmentHistory_customerId_idx";

-- DropIndex
DROP INDEX "AttendancePolicy_customerId_idx";

-- DropIndex
DROP INDEX "LeavePolicy_customerId_idx";

-- DropIndex
DROP INDEX "SalaryPolicy_customerId_idx";

-- DropIndex
DROP INDEX "ClaimPolicy_customerId_idx";

-- DropIndex
DROP INDEX "RemoteRequest_customerId_idx";

-- DropIndex
DROP INDEX "Shift_customerId_idx";

-- DropIndex
DROP INDEX "Shift_customerId_code_key";

-- DropIndex
DROP INDEX "ShiftGuidance_customerId_idx";

-- DropIndex
DROP INDEX "Visit_customerId_idx";

-- DropIndex
DROP INDEX "Visit_leadId_idx";

-- DropIndex
DROP INDEX "SalaryStructure_customerId_idx";

-- DropIndex
DROP INDEX "Payroll_customerId_idx";

-- DropIndex
DROP INDEX "Payroll_customerId_month_year_departmentId_key";

-- DropIndex
DROP INDEX "PayrollItem_customerId_idx";

-- DropIndex
DROP INDEX "SalarySlip_customerId_idx";

-- DropIndex
DROP INDEX "PayrollPolicy_customerId_key";

-- DropIndex
DROP INDEX "PayrollPolicy_customerId_idx";

-- DropIndex
DROP INDEX "Team_customerId_idx";

-- DropIndex
DROP INDEX "PlanEntitlement_customerId_idx";

-- DropIndex
DROP INDEX "Work_customerId_idx";

-- DropIndex
DROP INDEX "Work_subscriptionId_idx";

-- DropIndex
DROP INDEX "Work_customerId_scheduledDate_idx";

-- DropIndex
DROP INDEX "Work_customerId_status_idx";

-- DropIndex
DROP INDEX "DataCaptureJob_customerId_idx";

-- DropIndex
DROP INDEX "DataCapturePlace_customerId_idx";

-- DropIndex
DROP INDEX "DataCapturePlace_customerId_deletedAt_createdAt_idx";

-- DropIndex
DROP INDEX "DataCaptureSearch_customerId_idx";

-- DropIndex
DROP INDEX "DataCaptureSearch_customerId_employeeId_idx";

-- DropIndex
DROP INDEX "DataCaptureSearch_customerId_employeeId_searchedAt_idx";

-- DropIndex
DROP INDEX "EmployeeLoan_customerId_idx";

-- DropIndex
DROP INDEX "EmployeeClaim_customerId_idx";

-- DropIndex
DROP INDEX "monthly_schedules_customerId_idx";

-- DropIndex
DROP INDEX "monthly_schedules_subscriptionId_idx";

-- DropIndex
DROP INDEX "monthly_schedules_customerId_subscriptionId_month_year_key";

-- DropIndex
DROP INDEX "trending_contents_customerId_isActive_isPublished_idx";

-- DropIndex
DROP INDEX "marketing_banners_customerId_isActive_isPublished_idx";

-- DropIndex
DROP INDEX "marketing_videos_customerId_isActive_status_idx";

-- DropIndex
DROP INDEX "social_media_handlers_customerId_idx";

-- DropIndex
DROP INDEX "role_work_permissions_customerId_idx";

-- DropIndex
DROP INDEX "role_work_permissions_customerId_roleName_workModule_key";

-- DropIndex
DROP INDEX "work_access_requests_customerId_idx";

-- DropIndex
DROP INDEX "employee_module_overrides_customerId_idx";

-- DropIndex
DROP INDEX "employee_module_overrides_customerId_employeeId_moduleKey_key";

-- DropIndex
DROP INDEX "influencer_bookings_customerId_idx";

-- DropIndex
DROP INDEX "influencer_booking_payments_customerId_idx";

-- DropIndex
DROP INDEX "ai_credit_wallets_customerId_key";

-- DropIndex
DROP INDEX "ai_credit_wallets_customerId_idx";

-- DropIndex
DROP INDEX "ai_credit_transactions_customerId_idx";

-- DropIndex
DROP INDEX "ai_generations_customerId_idx";

-- DropIndex
DROP INDEX "social_accounts_customerId_idx";

-- DropIndex
DROP INDEX "social_accounts_customerId_platform_externalAccountId_key";

-- DropIndex
DROP INDEX "social_publishes_customerId_idx";

-- DropIndex
DROP INDEX "master_items_type_customerId_idx";

-- DropIndex
DROP INDEX "master_items_type_code_customerId_key";

-- DropIndex
DROP INDEX "email_templates_customerId_idx";

-- DropIndex
DROP INDEX "email_logs_customerId_idx";

-- DropIndex
DROP INDEX "email_logs_leadId_idx";

-- DropIndex
DROP INDEX "meta_templates_customerId_idx";

-- DropIndex
DROP INDEX "commission_configs_customerId_idx";

-- DropIndex
DROP INDEX "commissions_customerId_idx";

-- DropIndex
DROP INDEX "commissions_leadId_idx";

-- DropIndex
DROP INDEX "commissions_tenantId_qualifyingAt_idx";

-- AlterTable
ALTER TABLE "Plan" DROP COLUMN "leadLimit";

-- AlterTable
ALTER TABLE "Coupon" DROP COLUMN "perCustomerLimit";

-- AlterTable
ALTER TABLE "PaymentHistory" DROP COLUMN "customerId",
DROP COLUMN "subscriptionId";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Company" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Contact" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Pipeline" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Deal" DROP COLUMN "customerId",
DROP COLUMN "leadId";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Quotation" DROP COLUMN "customerId",
DROP COLUMN "leadId";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "SupportTicket" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "FeatureToggle" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "EmployeeLocation" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "BranchGeofence" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "LocationTrackingSetting" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Department" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Designation" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Attendance" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "LeaveType" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "LeaveRequest" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "PublicHoliday" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "EmployeeLeaveBalance" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "LeaveAdjustmentHistory" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "AttendancePolicy" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "LeavePolicy" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "SalaryPolicy" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "ClaimPolicy" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "RemoteRequest" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Shift" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "ShiftGuidance" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Visit" DROP COLUMN "customerId",
DROP COLUMN "leadId";

-- AlterTable
ALTER TABLE "SalaryStructure" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Payroll" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "PayrollItem" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "SalarySlip" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "PayrollPolicy" DROP COLUMN "customerId",
ADD COLUMN     "singletonKey" TEXT NOT NULL DEFAULT 'GLOBAL';

-- AlterTable
ALTER TABLE "Team" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "PlanEntitlement" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "Work" DROP COLUMN "customerId",
DROP COLUMN "subscriptionId";

-- AlterTable
ALTER TABLE "DataCaptureJob" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "DataCapturePlace" DROP COLUMN "customerId",
DROP COLUMN "importedLeadId";

-- AlterTable
ALTER TABLE "DataCaptureSearch" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "EmployeeLoan" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "EmployeeClaim" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "monthly_schedules" DROP COLUMN "customerId",
DROP COLUMN "subscriptionId";

-- AlterTable
ALTER TABLE "trending_contents" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "marketing_banners" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "marketing_videos" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "social_media_handlers" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "role_work_permissions" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "work_access_requests" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "employee_module_overrides" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "influencer_bookings" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "influencer_booking_payments" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "influencer_reviews" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "ai_credit_wallets" DROP COLUMN "customerId",
ADD COLUMN     "singletonKey" TEXT NOT NULL DEFAULT 'GLOBAL';

-- AlterTable
ALTER TABLE "ai_credit_transactions" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "ai_generations" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "social_accounts" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "social_publishes" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "master_items" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "email_templates" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "email_logs" DROP COLUMN "customerId",
DROP COLUMN "leadId";

-- AlterTable
ALTER TABLE "meta_templates" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "commission_configs" DROP COLUMN "customerId";

-- AlterTable
ALTER TABLE "commissions" DROP COLUMN "customerId",
DROP COLUMN "leadId",
DROP COLUMN "tenantId";

-- DropTable
DROP TABLE "customers";

-- DropTable
DROP TABLE "customer_subscriptions";

-- DropTable
DROP TABLE "coupon_redemptions";

-- DropTable
DROP TABLE "Lead";

-- DropTable
DROP TABLE "LeadStatusHistory";

-- DropTable
DROP TABLE "LeadNote";

-- DropTable
DROP TABLE "LeadActivityTimeline";

-- DropTable
DROP TABLE "LeadReminder";

-- DropTable
DROP TABLE "lead_stages";

-- DropTable
DROP TABLE "subscription_installments";

-- DropTable
DROP TABLE "custom_plan_orders";

-- DropTable
DROP TABLE "customer_marketing_video_views";

-- DropTable
DROP TABLE "customer_module_overrides";

-- DropTable
DROP TABLE "role_lead_limits";

-- DropTable
DROP TABLE "employee_lead_limits";

-- DropEnum
DROP TYPE "InstallmentStatus";

-- DropEnum
DROP TYPE "SubscriptionStatus";

-- DropEnum
DROP TYPE "LeadStatus";

-- DropEnum
DROP TYPE "LeadPriority";

-- CreateIndex
CREATE INDEX "Task_deletedAt_createdAt_idx" ON "Task"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureToggle_feature_key" ON "FeatureToggle"("feature");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_code_key" ON "Designation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");

-- CreateIndex
CREATE INDEX "Attendance_employeeId_date_idx" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_code_key" ON "LeaveType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_code_key" ON "Shift"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_month_year_departmentId_key" ON "Payroll"("month", "year", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPolicy_singletonKey_key" ON "PayrollPolicy"("singletonKey");

-- CreateIndex
CREATE INDEX "DataCapturePlace_deletedAt_createdAt_idx" ON "DataCapturePlace"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "DataCaptureSearch_employeeId_searchedAt_idx" ON "DataCaptureSearch"("employeeId", "searchedAt");

-- CreateIndex
CREATE INDEX "trending_contents_isActive_isPublished_idx" ON "trending_contents"("isActive", "isPublished");

-- CreateIndex
CREATE INDEX "marketing_banners_isActive_isPublished_idx" ON "marketing_banners"("isActive", "isPublished");

-- CreateIndex
CREATE INDEX "marketing_videos_isActive_status_idx" ON "marketing_videos"("isActive", "status");

-- CreateIndex
CREATE UNIQUE INDEX "role_work_permissions_roleName_workModule_key" ON "role_work_permissions"("roleName", "workModule");

-- CreateIndex
CREATE UNIQUE INDEX "employee_module_overrides_employeeId_moduleKey_key" ON "employee_module_overrides"("employeeId", "moduleKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_wallets_singletonKey_key" ON "ai_credit_wallets"("singletonKey");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_platform_externalAccountId_key" ON "social_accounts"("platform", "externalAccountId");

-- CreateIndex
CREATE INDEX "master_items_type_idx" ON "master_items"("type");

-- CreateIndex
CREATE UNIQUE INDEX "master_items_type_code_key" ON "master_items"("type", "code");

-- CreateIndex
CREATE INDEX "commissions_qualifyingAt_idx" ON "commissions"("qualifyingAt");

