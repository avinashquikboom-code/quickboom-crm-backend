export interface PermissionItem {
  module: string;
  action: string;
}

export const ALL_STANDARD_MODULES = [
  "DASHBOARD",
  "LEADS",
  "CUSTOMERS",
  "FOLLOW_UP",
  "VISITS",
  "PROPOSALS",
  "PACKAGES",
  "PAYMENTS",
  "WORK_EXECUTION",
  "CALENDAR",
  "MY_WORK",
  "CREATIVE_WORK",
  "ATTENDANCE",
  "LEAVE",
  "EXPENSES",
  "LOAN",
  "REMOTE_WORK",
  "TASKS",
  "SALARY",
  "NOTIFICATIONS",
  "REPORTS",
  "PROFILE",
  "SETTINGS",
  "DATA_CAPTURE",
] as const;

export type StandardModule = typeof ALL_STANDARD_MODULES[number];

export interface StandardPermissionDef {
  module: string;
  action: string;
  key: string;
  label: string;
  description: string;
  category: "CRM" | "WORKSPACE" | "CALENDAR" | "CREATIVE" | "HRM" | "SYSTEM";
}

export const STANDARD_PERMISSIONS: StandardPermissionDef[] = [
  // DASHBOARD
  { module: "DASHBOARD", action: "VIEW", key: "employee.dashboard.view", label: "View Dashboard", category: "SYSTEM", description: "Access main dashboard view and metrics" },
  { module: "DASHBOARD", action: "ATTENDANCE_VIEW", key: "employee.dashboard.attendance.view", label: "View Attendance Card", category: "SYSTEM", description: "View today's attendance summary on dashboard" },
  { module: "DASHBOARD", action: "CALENDAR_VIEW", key: "employee.dashboard.calendar.view", label: "View Calendar Card", category: "SYSTEM", description: "View upcoming calendar events on dashboard" },
  { module: "DASHBOARD", action: "NOTIFICATIONS_VIEW", key: "employee.dashboard.notifications.view", label: "View Notifications Feed", category: "SYSTEM", description: "View recent alert feed on dashboard" },
  { module: "DASHBOARD", action: "CARD_STATS", key: "employee.dashboard.card_stats", label: "Overview Stats Cards", category: "SYSTEM", description: "View performance and KPI summary cards" },
  { module: "DASHBOARD", action: "CARD_LEADS", key: "employee.dashboard.card_leads", label: "Leads Metric Widget", category: "SYSTEM", description: "View open leads count and urgent follow-up card" },
  { module: "DASHBOARD", action: "CARD_VISITS", key: "employee.dashboard.card_visits", label: "Visits Metric Widget", category: "SYSTEM", description: "View today's client field visits widget" },
  { module: "DASHBOARD", action: "CARD_WORK", key: "employee.dashboard.card_work", label: "Work Metric Widget", category: "SYSTEM", description: "View active SSM deliverables widget" },
  { module: "DASHBOARD", action: "CARD_PROPOSALS", key: "employee.dashboard.card_proposals", label: "Proposals Metric Widget", category: "SYSTEM", description: "View pending quotes and commercial proposals" },
  { module: "DASHBOARD", action: "CARD_EMPLOYEES", key: "employee.dashboard.card_employees", label: "Team Metric Widget", category: "SYSTEM", description: "View active staff and team overview widget" },

  // CALENDAR
  { module: "CALENDAR", action: "VIEW", key: "employee.calendar.view", label: "View Calendar", category: "CALENDAR", description: "Display Calendar in bottom navigation and menu" },
  { module: "CALENDAR", action: "VIEW_ASSIGNED", key: "employee.calendar.view_assigned", label: "View Assigned Calendar", category: "CALENDAR", description: "View user's personal schedule and assigned shoots/visits" },
  { module: "CALENDAR", action: "VIEW_TEAM", key: "employee.calendar.view_team", label: "View Team Calendar", category: "CALENDAR", description: "View cross-team shared shoots, visits, and milestones" },
  { module: "CALENDAR", action: "CREATE", key: "employee.calendar.create", label: "Create Event", category: "CALENDAR", description: "Create new calendar booking or task schedule" },
  { module: "CALENDAR", action: "EDIT", key: "employee.calendar.edit", label: "Edit Event", category: "CALENDAR", description: "Modify calendar booking details and timing" },
  { module: "CALENDAR", action: "DELETE", key: "employee.calendar.delete", label: "Delete Event", category: "CALENDAR", description: "Cancel or remove calendar events" },
  { module: "CALENDAR", action: "RESCHEDULE", key: "employee.calendar.reschedule", label: "Reschedule Event", category: "CALENDAR", description: "Change event date, slot, or assigned technician" },

  // MY WORK (WORKSPACE)
  { module: "MY_WORK", action: "VIEW", key: "employee.my_work.view", label: "View My Work", category: "WORKSPACE", description: "Display My Work in bottom nav and drawer for creative staff" },
  { module: "MY_WORK", action: "OPEN", key: "employee.my_work.open", label: "Open Work Item", category: "WORKSPACE", description: "Open detailed creative item sheet and deliverables" },
  { module: "MY_WORK", action: "START", key: "employee.my_work.start", label: "Start Work", category: "WORKSPACE", description: "Clock in and change work state to In Progress" },
  { module: "MY_WORK", action: "UPDATE_PROGRESS", key: "employee.my_work.update_progress", label: "Update Progress", category: "WORKSPACE", description: "Log work notes, revisions, and progress percentage" },
  { module: "MY_WORK", action: "UPLOAD", key: "employee.my_work.upload", label: "Upload Proof / Asset", category: "WORKSPACE", description: "Upload finished media files, raw photos, or draft links" },
  { module: "MY_WORK", action: "SUBMIT", key: "employee.my_work.submit", label: "Submit for Review", category: "WORKSPACE", description: "Submit completed creative work to client / supervisor" },
  { module: "MY_WORK", action: "COMPLETE", key: "employee.my_work.complete", label: "Mark Completed", category: "WORKSPACE", description: "Mark deliverable as fully finalized" },

  // LEADS (CRM)
  { module: "LEADS", action: "VIEW", key: "employee.leads.view", label: "View Leads", category: "CRM", description: "View CRM lead lists, pipeline view, and lead cards" },
  { module: "LEADS", action: "CREATE", key: "employee.leads.create", label: "Create Lead", category: "CRM", description: "Show 'Add Lead' button and capture new inquiries" },
  { module: "LEADS", action: "EDIT", key: "employee.leads.edit", label: "Edit Lead", category: "CRM", description: "Show 'Edit Lead' button and update lead profile" },
  { module: "LEADS", action: "DELETE", key: "employee.leads.delete", label: "Delete Lead", category: "CRM", description: "Show 'Delete Lead' action and remove lead records" },
  { module: "LEADS", action: "CHANGE_STAGE", key: "employee.leads.change_stage", label: "Change Stage / Status", category: "CRM", description: "Move leads across pipeline stages and statuses" },
  { module: "LEADS", action: "CALL", key: "employee.leads.call", label: "Click to Call Lead", category: "CRM", description: "Trigger phone dialer and log telecalling outcomes" },
  { module: "LEADS", action: "WHATSAPP", key: "employee.leads.whatsapp", label: "WhatsApp Lead", category: "CRM", description: "Send WhatsApp messages with template pitch" },
  { module: "LEADS", action: "EMAIL", key: "employee.leads.email", label: "Email Lead", category: "CRM", description: "Send emails directly to lead contacts" },
  { module: "LEADS", action: "SEND_DETAILS", key: "employee.leads.send_details", label: "Send Details Sheet", category: "CRM", description: "Dispatch company brochure or quotation info" },
  { module: "LEADS", action: "FOLLOW_UP", key: "employee.leads.follow_up", label: "Create Lead Follow-up", category: "CRM", description: "Directly schedule next call from lead details" },
  { module: "LEADS", action: "SCHEDULE_VISIT", key: "employee.leads.schedule_visit", label: "Schedule Lead Visit", category: "CRM", description: "Book on-site client demo or executive visit" },
  { module: "LEADS", action: "EXPORT", key: "employee.leads.export", label: "Export Leads", category: "CRM", description: "Export lead lists to CSV/Excel" },
  { module: "LEADS", action: "TAB_OVERVIEW", key: "employee.leads.tab_overview", label: "Lead Overview Tab", category: "CRM", description: "Display Lead overview and core demographics" },
  { module: "LEADS", action: "TAB_ACTIVITY", key: "employee.leads.tab_activity", label: "Lead Activity Tab", category: "CRM", description: "Display call logs, reminders, and activity history" },
  { module: "LEADS", action: "TAB_TIMELINE", key: "employee.leads.tab_timeline", label: "Lead Timeline Tab", category: "CRM", description: "Display pipeline milestone progression" },
  { module: "LEADS", action: "TAB_HISTORY", key: "employee.leads.tab_history", label: "Lead Audit History Tab", category: "CRM", description: "Display lead status audit trail" },

  // CUSTOMERS (CRM)
  { module: "CUSTOMERS", action: "VIEW", key: "employee.customers.view", label: "View Customers", category: "CRM", description: "View customer directory and accounts" },
  { module: "CUSTOMERS", action: "CREATE", key: "employee.customers.create", label: "Add Customer", category: "CRM", description: "Add new company customer account" },
  { module: "CUSTOMERS", action: "EDIT", key: "employee.customers.edit", label: "Edit Customer", category: "CRM", description: "Modify customer information" },
  { module: "CUSTOMERS", action: "DELETE", key: "employee.customers.delete", label: "Delete Customer", category: "CRM", description: "Deactivate or delete customer accounts" },
  { module: "CUSTOMERS", action: "EXPORT", key: "employee.customers.export", label: "Export Customers", category: "CRM", description: "Export customer master list" },
  { module: "CUSTOMERS", action: "TAB_OVERVIEW", key: "employee.customers.tab_overview", label: "Customer Overview Tab", category: "CRM", description: "View customer primary profile" },
  { module: "CUSTOMERS", action: "TAB_PLANS", key: "employee.customers.tab_plans", label: "Customer Plans Tab", category: "CRM", description: "View active subscription packages" },
  { module: "CUSTOMERS", action: "TAB_SCHEDULE", key: "employee.customers.tab_schedule", label: "Customer Schedule Tab", category: "CRM", description: "View recurring deliverables schedule" },

  // DATA CAPTURE (CRM)
  { module: "DATA_CAPTURE", action: "VIEW", key: "employee.data_capture.view", label: "View Data Capture", category: "CRM", description: "Display Data Capture screen, search places, and view extraction history" },
  { module: "DATA_CAPTURE", action: "CREATE", key: "employee.data_capture.create", label: "Extract / Create Records", category: "CRM", description: "Trigger new Google Places extraction or manually add prospect record" },
  { module: "DATA_CAPTURE", action: "EDIT", key: "employee.data_capture.edit", label: "Edit / Validate / Import", category: "CRM", description: "Edit captured prospect, validate status, or import to CRM Leads" },
  { module: "DATA_CAPTURE", action: "DELETE", key: "employee.data_capture.delete", label: "Delete Records", category: "CRM", description: "Delete captured prospect records or extraction jobs" },

  // FOLLOW-UPS (CRM)
  { module: "FOLLOW_UP", action: "VIEW", key: "employee.followups.view", label: "View Follow-ups", category: "CRM", description: "View upcoming and overdue follow-up calls" },
  { module: "FOLLOW_UP", action: "CREATE", key: "employee.followups.create", label: "Create Follow-up", category: "CRM", description: "Log and schedule new follow-up reminders" },
  { module: "FOLLOW_UP", action: "EDIT", key: "employee.followups.edit", label: "Edit Follow-up", category: "CRM", description: "Update follow-up note and due time" },
  { module: "FOLLOW_UP", action: "DELETE", key: "employee.followups.delete", label: "Delete Follow-up", category: "CRM", description: "Delete scheduled follow-up" },
  { module: "FOLLOW_UP", action: "CALL", key: "employee.followups.call", label: "Call from Follow-up", category: "CRM", description: "Initiate phone call directly from follow-up card" },
  { module: "FOLLOW_UP", action: "COMPLETE", key: "employee.followups.complete", label: "Complete Follow-up", category: "CRM", description: "Mark follow-up done with call disposition" },

  // FIELD VISITS (CRM)
  { module: "VISITS", action: "VIEW", key: "employee.visits.view", label: "View Visits", category: "CRM", description: "View scheduled client visits" },
  { module: "VISITS", action: "CREATE", key: "employee.visits.create", label: "Schedule Visit", category: "CRM", description: "Schedule client on-site visits" },
  { module: "VISITS", action: "EDIT", key: "employee.visits.edit", label: "Edit Visit", category: "CRM", description: "Update visit timing and agenda" },
  { module: "VISITS", action: "DELETE", key: "employee.visits.delete", label: "Delete Visit", category: "CRM", description: "Remove visit record" },
  { module: "VISITS", action: "START", key: "employee.visits.start", label: "Start / Check-in Visit", category: "CRM", description: "Log GPS check-in at client premises" },
  { module: "VISITS", action: "COMPLETE", key: "employee.visits.complete", label: "Complete / Check-out Visit", category: "CRM", description: "Log visit outcome, notes, and photos" },
  { module: "VISITS", action: "CANCEL", key: "employee.visits.cancel", label: "Cancel Visit", category: "CRM", description: "Mark visit as cancelled with reason" },

  // PROPOSALS (CRM)
  { module: "PROPOSALS", action: "VIEW", key: "employee.proposals.view", label: "View Proposals", category: "CRM", description: "View commercial quotes and proposals" },
  { module: "PROPOSALS", action: "CREATE", key: "employee.proposals.create", label: "Create Proposal", category: "CRM", description: "Draft new price proposal" },
  { module: "PROPOSALS", action: "EDIT", key: "employee.proposals.edit", label: "Edit Proposal", category: "CRM", description: "Update items, pricing, and terms" },
  { module: "PROPOSALS", action: "DELETE", key: "employee.proposals.delete", label: "Delete Proposal", category: "CRM", description: "Delete or void proposal" },
  { module: "PROPOSALS", action: "SEND", key: "employee.proposals.send", label: "Send Proposal", category: "CRM", description: "Dispatch proposal via email / WhatsApp" },
  { module: "PROPOSALS", action: "DOWNLOAD", key: "employee.proposals.download", label: "Download Proposal PDF", category: "CRM", description: "Generate and download proposal PDF" },

  // PACKAGES (CRM)
  { module: "PACKAGES", action: "VIEW", key: "employee.packages.view", label: "View Packages", category: "CRM", description: "Display Packages in CRM navigation and view plans" },
  { module: "PACKAGES", action: "CREATE", key: "employee.packages.create", label: "Create Package", category: "CRM", description: "Create new commercial service bundle" },
  { module: "PACKAGES", action: "EDIT", key: "employee.packages.edit", label: "Edit Package", category: "CRM", description: "Update pricing and package quotas" },
  { module: "PACKAGES", action: "DELETE", key: "employee.packages.delete", label: "Delete Package", category: "CRM", description: "Archive or delete package" },
  { module: "PACKAGES", action: "TOGGLE_STATUS", key: "employee.packages.toggle_status", label: "Toggle Package Status", category: "CRM", description: "Activate or deactivate package availability" },

  // PAYMENTS (CRM)
  { module: "PAYMENTS", action: "VIEW", key: "employee.payments.view", label: "View Payments", category: "CRM", description: "Display Payments in CRM menu" },
  { module: "PAYMENTS", action: "CREATE", key: "employee.payments.create", label: "Record Payment", category: "CRM", description: "Record incoming client payment" },
  { module: "PAYMENTS", action: "EDIT", key: "employee.payments.edit", label: "Edit Payment", category: "CRM", description: "Modify payment records" },
  { module: "PAYMENTS", action: "DELETE", key: "employee.payments.delete", label: "Delete Payment", category: "CRM", description: "Delete payment entries" },
  { module: "PAYMENTS", action: "EXPORT", key: "employee.payments.export", label: "Export Payments", category: "CRM", description: "Export payment financial records" },

  // WORK EXECUTION (CRM / DELIVERY)
  { module: "WORK_EXECUTION", action: "VIEW", key: "employee.work_execution.view", label: "View Work Execution", category: "CRM", description: "Display Work Execution project delivery dashboard" },
  { module: "WORK_EXECUTION", action: "CREATE", key: "employee.work_execution.create", label: "Create Project / Job", category: "CRM", description: "Initiate project deliverable tracking" },
  { module: "WORK_EXECUTION", action: "EDIT", key: "employee.work_execution.edit", label: "Edit Project Details", category: "CRM", description: "Update milestone dates and deliverables" },
  { module: "WORK_EXECUTION", action: "DELETE", key: "employee.work_execution.delete", label: "Delete Project", category: "CRM", description: "Cancel or delete delivery job" },
  { module: "WORK_EXECUTION", action: "MILESTONE_UPDATE", key: "employee.work_execution.milestone_update", label: "Update Milestone", category: "CRM", description: "Advance project delivery milestones" },
  { module: "WORK_EXECUTION", action: "REOPEN", key: "employee.work_execution.reopen", label: "Reopen Job", category: "CRM", description: "Reopen completed deliverable for revision" },

  // CREATIVE / SSM WORK
  { module: "CREATIVE_WORK", action: "VIEW", key: "employee.creative_work.view", label: "View Creative Work", category: "CREATIVE", description: "Display Social Media & Creative Work section" },
  { module: "CREATIVE_WORK", action: "OPEN", key: "employee.creative_work.open", label: "Open Creative Sheet", category: "CREATIVE", description: "Access creative briefs and asset previews" },
  { module: "CREATIVE_WORK", action: "ASSIGN", key: "employee.creative_work.assign", label: "Assign Creative Work", category: "CREATIVE", description: "Allocate tasks to editors, designers, shooters" },
  { module: "CREATIVE_WORK", action: "START", key: "employee.creative_work.start", label: "Start Creative Work", category: "CREATIVE", description: "Clock in on video edit, reel shoot, or design" },
  { module: "CREATIVE_WORK", action: "UPDATE", key: "employee.creative_work.update", label: "Update Creative Asset", category: "CREATIVE", description: "Edit draft copy, hashtags, or frame versions" },
  { module: "CREATIVE_WORK", action: "UPLOAD", key: "employee.creative_work.upload", label: "Upload Media Asset", category: "CREATIVE", description: "Upload footage, high-res renders, or graphics" },
  { module: "CREATIVE_WORK", action: "REVIEW", key: "employee.creative_work.review", label: "Review Creative Asset", category: "CREATIVE", description: "Provide supervisory feedback and mark changes" },
  { module: "CREATIVE_WORK", action: "APPROVE", key: "employee.creative_work.approve", label: "Approve Creative Asset", category: "CREATIVE", description: "Supervisory sign-off on deliverable quality" },
  { module: "CREATIVE_WORK", action: "SUBMIT", key: "employee.creative_work.submit", label: "Submit to Client", category: "CREATIVE", description: "Send creative preview to client for sign-off" },
  { module: "CREATIVE_WORK", action: "COMPLETE", key: "employee.creative_work.complete", label: "Complete Creative Asset", category: "CREATIVE", description: "Finalize creative task" },
  { module: "CREATIVE_WORK", action: "PUBLISH", key: "employee.creative_work.publish", label: "Publish / Schedule Post", category: "CREATIVE", description: "Live publish to Instagram/Facebook/LinkedIn" },

  // ATTENDANCE (HRM)
  { module: "ATTENDANCE", action: "VIEW", key: "employee.attendance.view", label: "View Attendance", category: "HRM", description: "Display Attendance in navigation and view logs" },
  { module: "ATTENDANCE", action: "CREATE", key: "employee.attendance.create", label: "Log Attendance", category: "HRM", description: "Legacy punch permission" },
  { module: "ATTENDANCE", action: "EDIT", key: "employee.attendance.edit", label: "Regularize Attendance", category: "HRM", description: "Submit regularization requests" },
  { module: "ATTENDANCE", action: "DELETE", key: "employee.attendance.delete", label: "Delete Attendance Log", category: "HRM", description: "Remove erroneous punch records" },
  { module: "ATTENDANCE", action: "PUNCH_IN", key: "employee.attendance.punch_in", label: "Punch In", category: "HRM", description: "Biometric and GPS check-in" },
  { module: "ATTENDANCE", action: "PUNCH_OUT", key: "employee.attendance.punch_out", label: "Punch Out", category: "HRM", description: "Biometric and GPS check-out" },
  { module: "ATTENDANCE", action: "START_BREAK", key: "employee.attendance.start_break", label: "Start Break", category: "HRM", description: "Log lunch or rest break start" },
  { module: "ATTENDANCE", action: "END_BREAK", key: "employee.attendance.end_break", label: "End Break", category: "HRM", description: "Log break resumption" },

  // LEAVE / REQUESTS (HRM)
  { module: "LEAVE", action: "VIEW", key: "employee.leave.view", label: "View Requests & Leaves", category: "HRM", description: "Display Requests in drawer and view status" },
  { module: "LEAVE", action: "CREATE", key: "employee.leave.create", label: "Apply for Leave", category: "HRM", description: "Submit paid, casual, or medical leave application" },
  { module: "LEAVE", action: "EDIT", key: "employee.leave.edit", label: "Edit Leave", category: "HRM", description: "Update pending leave application" },
  { module: "LEAVE", action: "DELETE", key: "employee.leave.delete", label: "Delete Leave", category: "HRM", description: "Remove leave request" },
  { module: "LEAVE", action: "CANCEL", key: "employee.leave.cancel", label: "Cancel Leave", category: "HRM", description: "Cancel submitted leave before approval" },
  { module: "LEAVE", action: "APPROVE", key: "employee.leave.approve", label: "Approve Leave", category: "HRM", description: "Manager approval for team leave requests" },
  { module: "LEAVE", action: "REJECT", key: "employee.leave.reject", label: "Reject Leave", category: "HRM", description: "Manager rejection for leave requests" },

  // EXPENSES (HRM)
  { module: "EXPENSES", action: "VIEW", key: "employee.expenses.view", label: "View Expenses Tab", category: "HRM", description: "Show Expenses tab in Requests screen" },
  { module: "EXPENSES", action: "CREATE", key: "employee.expenses.create", label: "Submit Expense Claim", category: "HRM", description: "Submit travel, food, or gear reimbursement" },
  { module: "EXPENSES", action: "EDIT", key: "employee.expenses.edit", label: "Edit Expense", category: "HRM", description: "Modify submitted expense claim" },
  { module: "EXPENSES", action: "CANCEL", key: "employee.expenses.cancel", label: "Cancel Expense", category: "HRM", description: "Cancel pending reimbursement claim" },

  // LOAN (HRM)
  { module: "LOAN", action: "VIEW", key: "employee.loans.view", label: "View Loans Tab", category: "HRM", description: "Show Loan advance tab in Requests" },
  { module: "LOAN", action: "CREATE", key: "employee.loans.create", label: "Apply for Loan Advance", category: "HRM", description: "Submit salary advance or loan request" },
  { module: "LOAN", action: "APPROVE", key: "employee.loans.approve", label: "Approve Loan", category: "HRM", description: "Authorize employee loan advance" },
  { module: "LOAN", action: "REJECT", key: "employee.loans.reject", label: "Reject Loan", category: "HRM", description: "Decline loan advance request" },

  // REMOTE WORK (HRM)
  { module: "REMOTE_WORK", action: "VIEW", key: "employee.remote_work.view", label: "View Remote Work", category: "HRM", description: "Display Remote Work in drawer and tab" },
  { module: "REMOTE_WORK", action: "CREATE", key: "employee.remote_work.create", label: "Apply Remote Work", category: "HRM", description: "Submit work-from-home application" },
  { module: "REMOTE_WORK", action: "EDIT", key: "employee.remote_work.edit", label: "Edit Remote Request", category: "HRM", description: "Update pending remote work application" },
  { module: "REMOTE_WORK", action: "CANCEL", key: "employee.remote_work.cancel", label: "Cancel Remote Request", category: "HRM", description: "Withdraw remote work application" },

  // TASKS (WORKSPACE)
  { module: "TASKS", action: "VIEW", key: "employee.tasks.view", label: "View Assigned Tasks", category: "WORKSPACE", description: "Display Tasks in drawer and view task board" },
  { module: "TASKS", action: "CREATE", key: "employee.tasks.create", label: "Create Task", category: "WORKSPACE", description: "Assign new task to team or self" },
  { module: "TASKS", action: "START", key: "employee.tasks.start", label: "Start Task", category: "WORKSPACE", description: "Transition task status to In Progress" },
  { module: "TASKS", action: "UPDATE", key: "employee.tasks.update", label: "Update Task", category: "WORKSPACE", description: "Update checklist and task notes" },
  { module: "TASKS", action: "SUBMIT_PROOF", key: "employee.tasks.submit_proof", label: "Submit Photo Proof", category: "WORKSPACE", description: "Attach photo / file proof of completion" },
  { module: "TASKS", action: "COMPLETE", key: "employee.tasks.complete", label: "Complete Task", category: "WORKSPACE", description: "Mark task fully done" },
  { module: "TASKS", action: "APPROVE", key: "employee.tasks.approve", label: "Approve Task Completion", category: "WORKSPACE", description: "Sign-off on submitted proof" },
  { module: "TASKS", action: "EDIT", key: "employee.tasks.edit", label: "Edit Task Details", category: "WORKSPACE", description: "Change due dates, priority, description" },
  { module: "TASKS", action: "DELETE", key: "employee.tasks.delete", label: "Delete Task", category: "WORKSPACE", description: "Remove task from board" },

  // SALARY (HRM)
  { module: "SALARY", action: "VIEW", key: "employee.salary.view", label: "View Salary & Slips", category: "HRM", description: "Display Salary in drawer and view payroll summary" },
  { module: "SALARY", action: "DOWNLOAD", key: "employee.salary.download", label: "Download Payslip PDF", category: "HRM", description: "Download monthly salary slips" },

  // NOTIFICATIONS (SYSTEM)
  { module: "NOTIFICATIONS", action: "VIEW", key: "employee.notifications.view", label: "View Notifications", category: "SYSTEM", description: "Display notification bell and alert center" },
  { module: "NOTIFICATIONS", action: "READ", key: "employee.notifications.read", label: "Mark Read", category: "SYSTEM", description: "Mark specific notification as read" },
  { module: "NOTIFICATIONS", action: "MARK_ALL_READ", key: "employee.notifications.mark_all_read", label: "Mark All Read", category: "SYSTEM", description: "Clear unread notification badge" },
  { module: "NOTIFICATIONS", action: "SEND", key: "employee.notifications.send", label: "Send Alerts", category: "SYSTEM", description: "Broadcast push notifications to team" },
  { module: "NOTIFICATIONS", action: "DELETE", key: "employee.notifications.delete", label: "Delete Notification", category: "SYSTEM", description: "Delete notifications" },

  // REPORTS (SYSTEM)
  { module: "REPORTS", action: "VIEW", key: "employee.reports.view", label: "View Reports", category: "SYSTEM", description: "View analytics reports in drawer" },
  { module: "REPORTS", action: "EXPORT", key: "employee.reports.export", label: "Export Reports", category: "SYSTEM", description: "Export report spreadsheets" },
  { module: "REPORTS", action: "DOWNLOAD", key: "employee.reports.download", label: "Download Reports", category: "SYSTEM", description: "Download PDF and Excel summaries" },

  // PROFILE (SYSTEM)
  { module: "PROFILE", action: "VIEW", key: "employee.profile.view", label: "View Profile", category: "SYSTEM", description: "Display Profile tab and view account details" },
  { module: "PROFILE", action: "EDIT", key: "employee.profile.edit", label: "Edit Profile", category: "SYSTEM", description: "Update personal contact details and avatar" },

  // SETTINGS (SYSTEM)
  { module: "SETTINGS", action: "VIEW", key: "employee.settings.view", label: "View Settings Screen", category: "SYSTEM", description: "Access Settings menu in drawer" },
  { module: "SETTINGS", action: "EDIT", key: "employee.settings.edit", label: "Edit Settings", category: "SYSTEM", description: "Modify application preferences" },
  { module: "SETTINGS", action: "SETTING_PROFILE", key: "employee.settings.profile", label: "Profile Setting Section", category: "SYSTEM", description: "Access company and profile settings tile" },
  { module: "SETTINGS", action: "SETTING_NOTIFICATIONS", key: "employee.settings.notifications", label: "Notification Setting Section", category: "SYSTEM", description: "Configure push notification alerts" },
  { module: "SETTINGS", action: "SETTING_INTEGRATIONS", key: "employee.settings.integrations", label: "Integrations Section", category: "SYSTEM", description: "Manage third-party integrations" },
  { module: "SETTINGS", action: "SETTING_USERS", key: "employee.settings.users", label: "User Management Section", category: "SYSTEM", description: "Manage team roles and user permissions" },
];

/**
 * Normalizes (module, action) to machine-readable dot-notation key (e.g. employee.leads.view)
 */
export function toPermissionKey(module: string, action: string): string {
  return `employee.${module.toLowerCase()}.${action.toLowerCase()}`;
}

/**
 * Normalizes dot-notation key back to { module, action }
 */
export function fromPermissionKey(key: string): { module: string; action: string } {
  const clean = key.trim().toLowerCase();
  const withoutPrefix = clean.startsWith("employee.") ? clean.substring(9) : clean;
  const parts = withoutPrefix.split(".");
  if (parts.length >= 2) {
    const mod = parts[0].toUpperCase();
    const act = parts.slice(1).join("_").toUpperCase();
    return { module: mod, action: act };
  }
  if (clean.includes(":")) {
    const p = clean.split(":");
    return { module: p[0].toUpperCase(), action: p[1].toUpperCase() };
  }
  return { module: clean.toUpperCase(), action: "VIEW" };
}

// -------------------------------------------------------------
// DEFAULT ROLE TEMPLATES
// -------------------------------------------------------------

/**
 * Customer mobile app modules. Kept separate from STANDARD_PERMISSIONS so
 * employee/admin default roles are not changed.
 */
export const CUSTOMER_APP_PERMISSIONS: StandardPermissionDef[] = [
  { module: "CUSTOMER_HOME", action: "VIEW", key: "employee.customer_home.view", label: "View Home", category: "SYSTEM", description: "Show the customer home tab" },
  { module: "CUSTOMER_PLANS", action: "VIEW", key: "employee.customer_plans.view", label: "View Plans", category: "SYSTEM", description: "Show subscription plans" },
  { module: "CUSTOMER_PLANS", action: "CREATE", key: "employee.customer_plans.create", label: "Purchase Plan", category: "SYSTEM", description: "Start checkout for a subscription plan" },
  { module: "CUSTOMER_TRENDING", action: "VIEW", key: "employee.customer_trending.view", label: "View Trending", category: "SYSTEM", description: "Show the trending tab" },
  { module: "CUSTOMER_ORDERS", action: "VIEW", key: "employee.customer_orders.view", label: "View Orders", category: "SYSTEM", description: "Show the customer's own orders" },
  { module: "CUSTOMER_INVOICES", action: "VIEW", key: "employee.customer_invoices.view", label: "View Invoices", category: "SYSTEM", description: "Show the customer's own invoices" },
  { module: "CUSTOMER_INVOICES", action: "DOWNLOAD", key: "employee.customer_invoices.download", label: "Download Invoice", category: "SYSTEM", description: "Download invoice or receipt documents" },
  { module: "CUSTOMER_PROFILE", action: "VIEW", key: "employee.customer_profile.view", label: "View Profile", category: "SYSTEM", description: "Show the account tab" },
  { module: "CUSTOMER_PROFILE", action: "EDIT", key: "employee.customer_profile.edit", label: "Edit Profile", category: "SYSTEM", description: "Update the customer profile" },
  { module: "CUSTOMER_CALENDAR", action: "VIEW", key: "employee.customer_calendar.view", label: "View Calendar", category: "SYSTEM", description: "Show the customer calendar" },
  { module: "CUSTOMER_SSM", action: "VIEW", key: "employee.customer_ssm.view", label: "View SSM Access", category: "SYSTEM", description: "Show social media account access" },
  { module: "CUSTOMER_INFLUENCERS", action: "VIEW", key: "employee.customer_influencers.view", label: "View Influencer Hub", category: "SYSTEM", description: "Show the influencer hub" },
  { module: "CUSTOMER_INFLUENCER_BOOKINGS", action: "VIEW", key: "employee.customer_influencer_bookings.view", label: "View Bookings", category: "SYSTEM", description: "Show the customer's influencer bookings" },
  { module: "CUSTOMER_NOTIFICATIONS", action: "VIEW", key: "employee.customer_notifications.view", label: "View Notifications", category: "SYSTEM", description: "Show customer notifications" },
  { module: "CUSTOMER_SUPPORT", action: "VIEW", key: "employee.customer_support.view", label: "View Support", category: "SYSTEM", description: "Show support and help" },
  { module: "CUSTOMER_SUPPORT", action: "CREATE", key: "employee.customer_support.create", label: "Create Support Request", category: "SYSTEM", description: "Submit a support request" },
  { module: "CUSTOMER_MARKETING", action: "VIEW", key: "employee.customer_marketing.view", label: "View Marketing & Offers", category: "SYSTEM", description: "Show promotional banners, coupon offers and marketing videos on Customer Home" },
];

export const ROLE_PERMISSION_DEFAULTS: Record<string, PermissionItem[]> = {
  SUPER_ADMIN: STANDARD_PERMISSIONS.map((p) => ({ module: p.module, action: p.action })),
  COMPANY_ADMIN: STANDARD_PERMISSIONS.map((p) => ({ module: p.module, action: p.action })),
  CUSTOMER: CUSTOMER_APP_PERMISSIONS.map((p) => ({ module: p.module, action: p.action })),

  // 1. TELECALLER: Calendar = OFF, My Work = OFF, Creative Work = OFF.
  // Full CRM Lead calling, stage change, follow-ups, visits capture.
  TELECALLER: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "DASHBOARD", action: "CARD_LEADS" },
    { module: "LEADS", action: "VIEW" },
    { module: "LEADS", action: "CREATE" },
    { module: "LEADS", action: "EDIT" },
    { module: "LEADS", action: "CHANGE_STAGE" },
    { module: "LEADS", action: "CALL" },
    { module: "LEADS", action: "WHATSAPP" },
    { module: "LEADS", action: "EMAIL" },
    { module: "LEADS", action: "SEND_DETAILS" },
    { module: "LEADS", action: "FOLLOW_UP" },
    { module: "LEADS", action: "SCHEDULE_VISIT" },
    { module: "LEADS", action: "TAB_OVERVIEW" },
    { module: "LEADS", action: "TAB_ACTIVITY" },
    { module: "FOLLOW_UP", action: "VIEW" },
    { module: "FOLLOW_UP", action: "CREATE" },
    { module: "FOLLOW_UP", action: "EDIT" },
    { module: "FOLLOW_UP", action: "CALL" },
    { module: "FOLLOW_UP", action: "COMPLETE" },
    { module: "VISITS", action: "VIEW" },
    { module: "VISITS", action: "CREATE" },
    { module: "CUSTOMERS", action: "VIEW" },
    { module: "CUSTOMERS", action: "TAB_OVERVIEW" },
    { module: "DATA_CAPTURE", action: "VIEW" },
    { module: "DATA_CAPTURE", action: "CREATE" },
    { module: "DATA_CAPTURE", action: "EDIT" },
    { module: "LEAVE", action: "VIEW" },
    { module: "LEAVE", action: "CREATE" },
    { module: "NOTIFICATIONS", action: "VIEW" },
    { module: "NOTIFICATIONS", action: "READ" },
    { module: "PROFILE", action: "VIEW" },
    { module: "PROFILE", action: "EDIT" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
    { module: "SETTINGS", action: "SETTING_NOTIFICATIONS" },
  ],

  // 2. DESIGNER: Calendar = ON, My Work = ON, Creative Work = ON (graphic/post design). CRM = OFF.
  DESIGNER: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "DASHBOARD", action: "CARD_WORK" },
    { module: "CALENDAR", action: "VIEW" },
    { module: "CALENDAR", action: "VIEW_ASSIGNED" },
    { module: "MY_WORK", action: "VIEW" },
    { module: "MY_WORK", action: "OPEN" },
    { module: "MY_WORK", action: "START" },
    { module: "MY_WORK", action: "UPDATE_PROGRESS" },
    { module: "MY_WORK", action: "UPLOAD" },
    { module: "MY_WORK", action: "SUBMIT" },
    { module: "MY_WORK", action: "COMPLETE" },
    { module: "CREATIVE_WORK", action: "VIEW" },
    { module: "CREATIVE_WORK", action: "OPEN" },
    { module: "CREATIVE_WORK", action: "START" },
    { module: "CREATIVE_WORK", action: "UPDATE" },
    { module: "CREATIVE_WORK", action: "UPLOAD" },
    { module: "CREATIVE_WORK", action: "SUBMIT" },
    { module: "CREATIVE_WORK", action: "COMPLETE" },
    { module: "ATTENDANCE", action: "VIEW" },
    { module: "ATTENDANCE", action: "PUNCH_IN" },
    { module: "ATTENDANCE", action: "PUNCH_OUT" },
    { module: "LEAVE", action: "VIEW" },
    { module: "LEAVE", action: "CREATE" },
    { module: "TASKS", action: "VIEW" },
    { module: "TASKS", action: "START" },
    { module: "TASKS", action: "UPDATE" },
    { module: "TASKS", action: "SUBMIT_PROOF" },
    { module: "TASKS", action: "COMPLETE" },
    { module: "SALARY", action: "VIEW" },
    { module: "SALARY", action: "DOWNLOAD" },
    { module: "NOTIFICATIONS", action: "VIEW" },
    { module: "NOTIFICATIONS", action: "READ" },
    { module: "PROFILE", action: "VIEW" },
    { module: "PROFILE", action: "EDIT" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
  ],
  GRAPHIC_DESIGNER: [], // alias handled dynamically

  // 3. EDITOR: Calendar = ON, My Work = ON, Creative Work = ON (video post-production). CRM = OFF.
  EDITOR: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "DASHBOARD", action: "CARD_WORK" },
    { module: "CALENDAR", action: "VIEW" },
    { module: "CALENDAR", action: "VIEW_ASSIGNED" },
    { module: "MY_WORK", action: "VIEW" },
    { module: "MY_WORK", action: "OPEN" },
    { module: "MY_WORK", action: "START" },
    { module: "MY_WORK", action: "UPDATE_PROGRESS" },
    { module: "MY_WORK", action: "UPLOAD" },
    { module: "MY_WORK", action: "SUBMIT" },
    { module: "MY_WORK", action: "COMPLETE" },
    { module: "CREATIVE_WORK", action: "VIEW" },
    { module: "CREATIVE_WORK", action: "OPEN" },
    { module: "CREATIVE_WORK", action: "START" },
    { module: "CREATIVE_WORK", action: "UPDATE" },
    { module: "CREATIVE_WORK", action: "UPLOAD" },
    { module: "CREATIVE_WORK", action: "SUBMIT" },
    { module: "CREATIVE_WORK", action: "COMPLETE" },
    { module: "ATTENDANCE", action: "VIEW" },
    { module: "ATTENDANCE", action: "PUNCH_IN" },
    { module: "ATTENDANCE", action: "PUNCH_OUT" },
    { module: "LEAVE", action: "VIEW" },
    { module: "LEAVE", action: "CREATE" },
    { module: "TASKS", action: "VIEW" },
    { module: "TASKS", action: "START" },
    { module: "TASKS", action: "UPDATE" },
    { module: "TASKS", action: "SUBMIT_PROOF" },
    { module: "TASKS", action: "COMPLETE" },
    { module: "SALARY", action: "VIEW" },
    { module: "SALARY", action: "DOWNLOAD" },
    { module: "NOTIFICATIONS", action: "VIEW" },
    { module: "NOTIFICATIONS", action: "READ" },
    { module: "PROFILE", action: "VIEW" },
    { module: "PROFILE", action: "EDIT" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
  ],
  VIDEO_EDITOR: [], // alias handled dynamically

  // 4. SOCIAL MEDIA MANAGER: Calendar = ON, My Work = ON, Creative Work = ON (Assign, Review, Approve, Publish).
  SOCIAL_MEDIA_MANAGER: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "DASHBOARD", action: "CARD_WORK" },
    { module: "CALENDAR", action: "VIEW" },
    { module: "CALENDAR", action: "VIEW_ASSIGNED" },
    { module: "CALENDAR", action: "VIEW_TEAM" },
    { module: "CALENDAR", action: "CREATE" },
    { module: "CALENDAR", action: "EDIT" },
    { module: "CALENDAR", action: "RESCHEDULE" },
    { module: "MY_WORK", action: "VIEW" },
    { module: "MY_WORK", action: "OPEN" },
    { module: "MY_WORK", action: "START" },
    { module: "MY_WORK", action: "UPDATE_PROGRESS" },
    { module: "MY_WORK", action: "UPLOAD" },
    { module: "MY_WORK", action: "SUBMIT" },
    { module: "MY_WORK", action: "COMPLETE" },
    { module: "CREATIVE_WORK", action: "VIEW" },
    { module: "CREATIVE_WORK", action: "OPEN" },
    { module: "CREATIVE_WORK", action: "ASSIGN" },
    { module: "CREATIVE_WORK", action: "START" },
    { module: "CREATIVE_WORK", action: "UPDATE" },
    { module: "CREATIVE_WORK", action: "UPLOAD" },
    { module: "CREATIVE_WORK", action: "REVIEW" },
    { module: "CREATIVE_WORK", action: "APPROVE" },
    { module: "CREATIVE_WORK", action: "SUBMIT" },
    { module: "CREATIVE_WORK", action: "COMPLETE" },
    { module: "CREATIVE_WORK", action: "PUBLISH" },
    { module: "ATTENDANCE", action: "VIEW" },
    { module: "ATTENDANCE", action: "PUNCH_IN" },
    { module: "ATTENDANCE", action: "PUNCH_OUT" },
    { module: "LEAVE", action: "VIEW" },
    { module: "LEAVE", action: "CREATE" },
    { module: "TASKS", action: "VIEW" },
    { module: "TASKS", action: "CREATE" },
    { module: "TASKS", action: "START" },
    { module: "TASKS", action: "UPDATE" },
    { module: "TASKS", action: "SUBMIT_PROOF" },
    { module: "TASKS", action: "COMPLETE" },
    { module: "TASKS", action: "APPROVE" },
    { module: "SALARY", action: "VIEW" },
    { module: "SALARY", action: "DOWNLOAD" },
    { module: "NOTIFICATIONS", action: "VIEW" },
    { module: "NOTIFICATIONS", action: "READ" },
    { module: "PROFILE", action: "VIEW" },
    { module: "PROFILE", action: "EDIT" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
  ],
  SOCIAL_MEDIA_EXECUTIVE: [], // alias handled dynamically

  // 5. PHOTOGRAPHER: Calendar = ON, My Work = ON, Creative Work = ON (on-site shoots, footage upload). CRM = OFF.
  PHOTOGRAPHER: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "DASHBOARD", action: "CARD_WORK" },
    { module: "CALENDAR", action: "VIEW" },
    { module: "CALENDAR", action: "VIEW_ASSIGNED" },
    { module: "CALENDAR", action: "RESCHEDULE" },
    { module: "MY_WORK", action: "VIEW" },
    { module: "MY_WORK", action: "OPEN" },
    { module: "MY_WORK", action: "START" },
    { module: "MY_WORK", action: "UPDATE_PROGRESS" },
    { module: "MY_WORK", action: "UPLOAD" },
    { module: "MY_WORK", action: "SUBMIT" },
    { module: "MY_WORK", action: "COMPLETE" },
    { module: "CREATIVE_WORK", action: "VIEW" },
    { module: "CREATIVE_WORK", action: "OPEN" },
    { module: "CREATIVE_WORK", action: "START" },
    { module: "CREATIVE_WORK", action: "UPDATE" },
    { module: "CREATIVE_WORK", action: "UPLOAD" },
    { module: "CREATIVE_WORK", action: "SUBMIT" },
    { module: "ATTENDANCE", action: "VIEW" },
    { module: "ATTENDANCE", action: "PUNCH_IN" },
    { module: "ATTENDANCE", action: "PUNCH_OUT" },
    { module: "LEAVE", action: "VIEW" },
    { module: "LEAVE", action: "CREATE" },
    { module: "TASKS", action: "VIEW" },
    { module: "TASKS", action: "START" },
    { module: "TASKS", action: "UPDATE" },
    { module: "TASKS", action: "SUBMIT_PROOF" },
    { module: "TASKS", action: "COMPLETE" },
    { module: "SALARY", action: "VIEW" },
    { module: "SALARY", action: "DOWNLOAD" },
    { module: "NOTIFICATIONS", action: "VIEW" },
    { module: "NOTIFICATIONS", action: "READ" },
    { module: "PROFILE", action: "VIEW" },
    { module: "PROFILE", action: "EDIT" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
  ],
  REEL_SHOOTER: [], // alias
  VIDEOGRAPHER: [], // alias

  // Existing Standard Roles preserved
  SALES_EXECUTIVE: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "DASHBOARD", action: "CARD_LEADS" },
    { module: "DASHBOARD", action: "CARD_VISITS" },
    { module: "CALENDAR", action: "VIEW" },
    { module: "CALENDAR", action: "VIEW_ASSIGNED" },
    { module: "LEADS", action: "VIEW" },
    { module: "LEADS", action: "CREATE" },
    { module: "LEADS", action: "EDIT" },
    { module: "LEADS", action: "CHANGE_STAGE" },
    { module: "LEADS", action: "CALL" },
    { module: "LEADS", action: "WHATSAPP" },
    { module: "LEADS", action: "FOLLOW_UP" },
    { module: "LEADS", action: "SCHEDULE_VISIT" },
    { module: "FOLLOW_UP", action: "VIEW" },
    { module: "FOLLOW_UP", action: "CREATE" },
    { module: "FOLLOW_UP", action: "EDIT" },
    { module: "FOLLOW_UP", action: "CALL" },
    { module: "FOLLOW_UP", action: "COMPLETE" },
    { module: "VISITS", action: "VIEW" },
    { module: "VISITS", action: "CREATE" },
    { module: "VISITS", action: "EDIT" },
    { module: "VISITS", action: "START" },
    { module: "VISITS", action: "COMPLETE" },
    { module: "CUSTOMERS", action: "VIEW" },
    { module: "DATA_CAPTURE", action: "VIEW" },
    { module: "DATA_CAPTURE", action: "CREATE" },
    { module: "DATA_CAPTURE", action: "EDIT" },
    { module: "PROPOSALS", action: "VIEW" },
    { module: "PROPOSALS", action: "CREATE" },
    { module: "PACKAGES", action: "VIEW" },
    { module: "ATTENDANCE", action: "VIEW" },
    { module: "ATTENDANCE", action: "PUNCH_IN" },
    { module: "ATTENDANCE", action: "PUNCH_OUT" },
    { module: "TASKS", action: "VIEW" },
    { module: "TASKS", action: "EDIT" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
  ],
  HR: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "DASHBOARD", action: "CARD_EMPLOYEES" },
    { module: "ATTENDANCE", action: "VIEW" },
    { module: "ATTENDANCE", action: "CREATE" },
    { module: "ATTENDANCE", action: "EDIT" },
    { module: "ATTENDANCE", action: "DELETE" },
    { module: "ATTENDANCE", action: "PUNCH_IN" },
    { module: "ATTENDANCE", action: "PUNCH_OUT" },
    { module: "LEAVE", action: "VIEW" },
    { module: "LEAVE", action: "CREATE" },
    { module: "LEAVE", action: "EDIT" },
    { module: "LEAVE", action: "DELETE" },
    { module: "LEAVE", action: "APPROVE" },
    { module: "LEAVE", action: "REJECT" },
    { module: "REMOTE_WORK", action: "VIEW" },
    { module: "REMOTE_WORK", action: "CREATE" },
    { module: "REMOTE_WORK", action: "EDIT" },
    { module: "EXPENSES", action: "VIEW" },
    { module: "EXPENSES", action: "CREATE" },
    { module: "SALARY", action: "VIEW" },
    { module: "SALARY", action: "DOWNLOAD" },
    { module: "REPORTS", action: "VIEW" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
  ],
  EMPLOYEE: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "ATTENDANCE", action: "VIEW" },
    { module: "ATTENDANCE", action: "PUNCH_IN" },
    { module: "ATTENDANCE", action: "PUNCH_OUT" },
    { module: "LEAVE", action: "VIEW" },
    { module: "LEAVE", action: "CREATE" },
    { module: "TASKS", action: "VIEW" },
    { module: "TASKS", action: "START" },
    { module: "TASKS", action: "COMPLETE" },
    { module: "SALARY", action: "VIEW" },
    { module: "SALARY", action: "DOWNLOAD" },
    { module: "PROFILE", action: "VIEW" },
    { module: "PROFILE", action: "EDIT" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
  ],
  MANAGER: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "DASHBOARD", action: "CARD_LEADS" },
    { module: "DASHBOARD", action: "CARD_VISITS" },
    { module: "DASHBOARD", action: "CARD_WORK" },
    { module: "DASHBOARD", action: "CARD_EMPLOYEES" },
    { module: "CALENDAR", action: "VIEW" },
    { module: "CALENDAR", action: "VIEW_TEAM" },
    { module: "LEADS", action: "VIEW" },
    { module: "LEADS", action: "CREATE" },
    { module: "LEADS", action: "EDIT" },
    { module: "LEADS", action: "DELETE" },
    { module: "LEADS", action: "CHANGE_STAGE" },
    { module: "LEADS", action: "EXPORT" },
    { module: "CUSTOMERS", action: "VIEW" },
    { module: "CUSTOMERS", action: "CREATE" },
    { module: "CUSTOMERS", action: "EDIT" },
    { module: "DATA_CAPTURE", action: "VIEW" },
    { module: "DATA_CAPTURE", action: "CREATE" },
    { module: "DATA_CAPTURE", action: "EDIT" },
    { module: "DATA_CAPTURE", action: "DELETE" },
    { module: "FOLLOW_UP", action: "VIEW" },
    { module: "FOLLOW_UP", action: "CREATE" },
    { module: "FOLLOW_UP", action: "EDIT" },
    { module: "FOLLOW_UP", action: "DELETE" },
    { module: "VISITS", action: "VIEW" },
    { module: "VISITS", action: "CREATE" },
    { module: "VISITS", action: "EDIT" },
    { module: "VISITS", action: "DELETE" },
    { module: "ATTENDANCE", action: "VIEW" },
    { module: "ATTENDANCE", action: "CREATE" },
    { module: "ATTENDANCE", action: "EDIT" },
    { module: "LEAVE", action: "VIEW" },
    { module: "LEAVE", action: "CREATE" },
    { module: "LEAVE", action: "EDIT" },
    { module: "LEAVE", action: "APPROVE" },
    { module: "LEAVE", action: "REJECT" },
    { module: "TASKS", action: "VIEW" },
    { module: "TASKS", action: "CREATE" },
    { module: "TASKS", action: "EDIT" },
    { module: "TASKS", action: "APPROVE" },
    { module: "REPORTS", action: "VIEW" },
    { module: "REPORTS", action: "EXPORT" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
  ],

  // 9. VISITOR / FIELD OFFICER:
  // Receives assigned visits, check-in (start), and complete.
  // Intentionally does NOT have VISITS:CREATE (only Admin / BPO / Telecaller schedules visits).
  VISITOR: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "DASHBOARD", action: "CARD_VISITS" },
    { module: "CALENDAR", action: "VIEW" },
    { module: "CALENDAR", action: "VIEW_ASSIGNED" },
    { module: "VISITS", action: "VIEW" },
    { module: "VISITS", action: "START" },
    { module: "VISITS", action: "COMPLETE" },
    { module: "LEADS", action: "VIEW" },
    { module: "LEADS", action: "TAB_OVERVIEW" },
    { module: "LEADS", action: "TAB_ACTIVITY" },
    { module: "ATTENDANCE", action: "VIEW" },
    { module: "ATTENDANCE", action: "PUNCH_IN" },
    { module: "ATTENDANCE", action: "PUNCH_OUT" },
    { module: "LEAVE", action: "VIEW" },
    { module: "LEAVE", action: "CREATE" },
    { module: "NOTIFICATIONS", action: "VIEW" },
    { module: "NOTIFICATIONS", action: "READ" },
    { module: "PROFILE", action: "VIEW" },
    { module: "PROFILE", action: "EDIT" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
  ],

  // 10. PRODUCTION TEAM MEMBER: Calendar = ON (VIEW only, no CREATE), My Work = ON, Creative Work = ON. CRM = OFF.
  PRODUCTION_TEAM_MEMBER: [
    { module: "DASHBOARD", action: "VIEW" },
    { module: "DASHBOARD", action: "CARD_STATS" },
    { module: "DASHBOARD", action: "CARD_WORK" },
    { module: "CALENDAR", action: "VIEW" },
    { module: "CALENDAR", action: "VIEW_ASSIGNED" },
    { module: "CALENDAR", action: "VIEW_TEAM" },
    { module: "MY_WORK", action: "VIEW" },
    { module: "MY_WORK", action: "OPEN" },
    { module: "MY_WORK", action: "START" },
    { module: "MY_WORK", action: "UPDATE_PROGRESS" },
    { module: "MY_WORK", action: "UPLOAD" },
    { module: "MY_WORK", action: "SUBMIT" },
    { module: "MY_WORK", action: "COMPLETE" },
    { module: "CREATIVE_WORK", action: "VIEW" },
    { module: "CREATIVE_WORK", action: "OPEN" },
    { module: "CREATIVE_WORK", action: "START" },
    { module: "CREATIVE_WORK", action: "UPDATE" },
    { module: "CREATIVE_WORK", action: "UPLOAD" },
    { module: "CREATIVE_WORK", action: "SUBMIT" },
    { module: "CREATIVE_WORK", action: "COMPLETE" },
    { module: "WORK_EXECUTION", action: "VIEW" },
    { module: "ATTENDANCE", action: "VIEW" },
    { module: "ATTENDANCE", action: "PUNCH_IN" },
    { module: "ATTENDANCE", action: "PUNCH_OUT" },
    { module: "LEAVE", action: "VIEW" },
    { module: "LEAVE", action: "CREATE" },
    { module: "TASKS", action: "VIEW" },
    { module: "TASKS", action: "START" },
    { module: "TASKS", action: "UPDATE" },
    { module: "TASKS", action: "SUBMIT_PROOF" },
    { module: "TASKS", action: "COMPLETE" },
    { module: "SALARY", action: "VIEW" },
    { module: "SALARY", action: "DOWNLOAD" },
    { module: "NOTIFICATIONS", action: "VIEW" },
    { module: "NOTIFICATIONS", action: "READ" },
    { module: "PROFILE", action: "VIEW" },
    { module: "PROFILE", action: "EDIT" },
    { module: "SETTINGS", action: "VIEW" },
    { module: "SETTINGS", action: "SETTING_PROFILE" },
  ],
};

// Aliases for matching
ROLE_PERMISSION_DEFAULTS.GRAPHIC_DESIGNER = ROLE_PERMISSION_DEFAULTS.DESIGNER;
ROLE_PERMISSION_DEFAULTS.VIDEO_EDITOR = ROLE_PERMISSION_DEFAULTS.EDITOR;
ROLE_PERMISSION_DEFAULTS.SOCIAL_MEDIA_EXECUTIVE = ROLE_PERMISSION_DEFAULTS.SOCIAL_MEDIA_MANAGER;
ROLE_PERMISSION_DEFAULTS.REEL_SHOOTER = ROLE_PERMISSION_DEFAULTS.PHOTOGRAPHER;
ROLE_PERMISSION_DEFAULTS.VIDEOGRAPHER = ROLE_PERMISSION_DEFAULTS.PHOTOGRAPHER;
ROLE_PERMISSION_DEFAULTS.PRODUCTION_TEAM = ROLE_PERMISSION_DEFAULTS.PRODUCTION_TEAM_MEMBER;
ROLE_PERMISSION_DEFAULTS.PRODUCTION = ROLE_PERMISSION_DEFAULTS.PRODUCTION_TEAM_MEMBER;
ROLE_PERMISSION_DEFAULTS.PRODUCTION_MEMBER = ROLE_PERMISSION_DEFAULTS.PRODUCTION_TEAM_MEMBER;
ROLE_PERMISSION_DEFAULTS.PRODUCTION_EXECUTIVE = ROLE_PERMISSION_DEFAULTS.PRODUCTION_TEAM_MEMBER;
ROLE_PERMISSION_DEFAULTS.TELESALES_EXECUTIVE = ROLE_PERMISSION_DEFAULTS.TELECALLER;
ROLE_PERMISSION_DEFAULTS.TELESALES = ROLE_PERMISSION_DEFAULTS.TELECALLER;
ROLE_PERMISSION_DEFAULTS.TELESELLER = ROLE_PERMISSION_DEFAULTS.TELECALLER;
ROLE_PERMISSION_DEFAULTS.BPO = ROLE_PERMISSION_DEFAULTS.TELECALLER;
ROLE_PERMISSION_DEFAULTS.BPO_EXECUTIVE = ROLE_PERMISSION_DEFAULTS.TELECALLER;
ROLE_PERMISSION_DEFAULTS.CALLER = ROLE_PERMISSION_DEFAULTS.TELECALLER;
ROLE_PERMISSION_DEFAULTS.CALL_CENTER_EXECUTIVE = ROLE_PERMISSION_DEFAULTS.TELECALLER;
ROLE_PERMISSION_DEFAULTS.TELECALLER_EXECUTIVE = ROLE_PERMISSION_DEFAULTS.TELECALLER;
ROLE_PERMISSION_DEFAULTS.FIELD_EXECUTIVE = ROLE_PERMISSION_DEFAULTS.SALES_EXECUTIVE;
ROLE_PERMISSION_DEFAULTS.FIELD_VISITOR = ROLE_PERMISSION_DEFAULTS.VISITOR;
ROLE_PERMISSION_DEFAULTS.FIELD_OFFICER = ROLE_PERMISSION_DEFAULTS.VISITOR;
ROLE_PERMISSION_DEFAULTS.BUSINESS_DEVELOPMENT_EXECUTIVE = ROLE_PERMISSION_DEFAULTS.SALES_EXECUTIVE;
ROLE_PERMISSION_DEFAULTS.BDE = ROLE_PERMISSION_DEFAULTS.SALES_EXECUTIVE;


