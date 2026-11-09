export type ReportDefinition = {
  id: string;
  category: string;
  name: string;
  description: string;
  available: boolean;
  sensitive?: 'payroll';
  type?: string;
  preset?: Record<string, string>;
  filters?: string[];
  reason?: string;
};

export const REPORT_CATEGORIES = [
  { id: 'favourite', name: 'Favourite', icon: 'star' },
  { id: 'sales', name: 'Sales & CRM', icon: 'handshake' },
  { id: 'hrm', name: 'HRM & Employees', icon: 'users' },
  { id: 'attendance', name: 'Attendance', icon: 'calendar' },
  { id: 'payroll', name: 'Payroll & Salary', icon: 'money-bill' },
  { id: 'billing', name: 'Customers & Billing', icon: 'file-invoice' },
  { id: 'deals', name: 'Deals & Follow-ups', icon: 'phone' },
  { id: 'inventory', name: 'Inventory & Production', icon: 'boxes' },
  { id: 'influencer', name: 'Influencer Management', icon: 'bullhorn' },
  { id: 'social', name: 'AI & Social', icon: 'share-nodes' },
  { id: 'finance', name: 'Finance', icon: 'chart-line' },
  { id: 'system', name: 'System & Activity', icon: 'shield' },
  { id: 'other', name: 'Other Reports', icon: 'folder' },
];

const unavailable = (id: string, category: string, name: string, reason: string): ReportDefinition => ({
  id, category, name, description: reason, available: false, reason,
});

export const REPORT_CATALOG: ReportDefinition[] = [
  { id: 'leads-summary', category: 'sales', name: 'Leads Summary', description: 'Leads created in the selected period.', available: true, type: 'LEADS', filters: ['date', 'status'] },
  { id: 'leads-status', category: 'sales', name: 'Leads by Status', description: 'Lead counts and rows grouped by status.', available: true, type: 'LEADS', filters: ['date', 'status'] },
  { id: 'leads-source', category: 'sales', name: 'Leads by Source', description: 'Leads with their recorded source.', available: true, type: 'LEADS', filters: ['date'] },
  { id: 'leads-category', category: 'sales', name: 'Leads by Category', description: 'Leads with their recorded category.', available: true, type: 'LEADS', filters: ['date'] },
  { id: 'lead-conversion', category: 'sales', name: 'Lead Conversion Report', description: 'Leads marked won or converted.', available: true, type: 'LEADS', preset: { status: 'WON' }, filters: ['date'] },
  { id: 'employee-leads', category: 'sales', name: 'Employee-wise Leads', description: 'Leads with the assigned employee.', available: true, type: 'LEADS', filters: ['date'] },
  { id: 'customer-report', category: 'sales', name: 'Customer Report', description: 'Tenant customer records.', available: true, type: 'CUSTOMERS', filters: ['date', 'status'] },
  { id: 'visits', category: 'sales', name: 'Visits Report', description: 'Field visits in the selected period.', available: true, type: 'VISITS', filters: ['date', 'status'] },
  { id: 'tasks', category: 'sales', name: 'Tasks Report', description: 'Tasks created in the selected period.', available: true, type: 'TASKS', filters: ['date', 'status'] },
  { id: 'sales-activity', category: 'sales', name: 'Sales Activity Report', description: 'CRM audit activity in the selected period.', available: true, type: 'AUDIT', preset: { module: 'CRM' }, filters: ['date'] },

  { id: 'employee-master', category: 'hrm', name: 'Employee Master Report', description: 'Employee records for this tenant.', available: true, type: 'EMPLOYEES', filters: ['status', 'department'] },
  { id: 'employee-directory', category: 'hrm', name: 'Employee Directory', description: 'Names, codes, departments and contact details.', available: true, type: 'EMPLOYEES', filters: ['department'] },
  { id: 'department-employees', category: 'hrm', name: 'Department-wise Employees', description: 'Employees filtered by department.', available: true, type: 'EMPLOYEES', filters: ['department'] },
  { id: 'designation-employees', category: 'hrm', name: 'Designation-wise Employees', description: 'Employees with designation.', available: true, type: 'EMPLOYEES', filters: ['department'] },
  { id: 'joining-report', category: 'hrm', name: 'Employee Joining Report', description: 'Employees whose joining date falls in the period.', available: true, type: 'EMPLOYEES', preset: { dateField: 'joining' }, filters: ['date'] },
  { id: 'employee-status', category: 'hrm', name: 'Employee Status Report', description: 'Employees by active or inactive status.', available: true, type: 'EMPLOYEES', filters: ['status'] },
  unavailable('employee-exit', 'hrm', 'Employee Exit Report', 'Employees do not have an exit date, so an exit report cannot be calculated.'),
  unavailable('employee-performance', 'hrm', 'Employee Performance Report', 'There is no performance-review dataset to report.'),
  unavailable('team-performance', 'hrm', 'Team-wise Performance', 'There is no team performance dataset to report.'),

  { id: 'daily-attendance', category: 'attendance', name: 'Daily Attendance', description: 'Attendance records in the selected dates.', available: true, type: 'ATTENDANCE', filters: ['date', 'status', 'department'] },
  { id: 'monthly-attendance', category: 'attendance', name: 'Monthly Attendance', description: 'Attendance records for the selected month range.', available: true, type: 'ATTENDANCE', filters: ['date', 'department'] },
  { id: 'employee-attendance', category: 'attendance', name: 'Employee-wise Attendance', description: 'Attendance with employee name and department.', available: true, type: 'ATTENDANCE', filters: ['date', 'department'] },
  { id: 'present-absent', category: 'attendance', name: 'Present / Absent Report', description: 'Filter attendance by present or absent.', available: true, type: 'ATTENDANCE', filters: ['date', 'status'] },
  { id: 'late-arrival', category: 'attendance', name: 'Late Arrival Report', description: 'Attendance marked late.', available: true, type: 'ATTENDANCE', preset: { status: 'LATE' }, filters: ['date'] },
  unavailable('early-leaving', 'attendance', 'Early Leaving Report', 'Attendance does not store an early-leaving flag.'),
  unavailable('overtime-report', 'attendance', 'Overtime Report', 'Overtime requests are not included in the reports dataset yet.'),
  { id: 'break-report', category: 'attendance', name: 'Break Report', description: 'Attendance rows include recorded break duration.', available: true, type: 'ATTENDANCE', filters: ['date'] },
  unavailable('geo-attendance', 'attendance', 'Geo Attendance Report', 'Location points are not aggregated into a report.'),
  unavailable('remote-work', 'attendance', 'Remote Work Report', 'Remote-work requests are not exposed through the reports API.'),

  { id: 'payroll-summary', category: 'payroll', name: 'Monthly Payroll Summary', description: 'Salary slips generated in the period.', available: true, sensitive: 'payroll', type: 'PAYROLL', filters: ['date', 'status'] },
  { id: 'salary-register', category: 'payroll', name: 'Salary Register', description: 'Gross, deductions and net salary by employee.', available: true, sensitive: 'payroll', type: 'PAYROLL', filters: ['date'] },
  { id: 'salary-slip-report', category: 'payroll', name: 'Salary Slip Report', description: 'Generated salary slips.', available: true, sensitive: 'payroll', type: 'PAYROLL', filters: ['date', 'status'] },
  { id: 'payroll-status', category: 'payroll', name: 'Payroll Payment Status', description: 'Salary slips filtered by status.', available: true, sensitive: 'payroll', type: 'PAYROLL', filters: ['date', 'status'] },
  unavailable('lop-report', 'payroll', 'LOP Deduction Report', 'LOP is calculated inside payroll items and is not stored as its own report table.'),
  unavailable('overtime-pay', 'payroll', 'Overtime Payment Report', 'Overtime payment is not a separate report query.'),
  unavailable('reimbursement', 'payroll', 'Expense Reimbursement Report', 'Claims are not included in the reports dataset yet.'),
  unavailable('loan-deduction', 'payroll', 'Loan Deduction Report', 'Loan deductions are not exposed as a report query.'),
  unavailable('commission-report', 'payroll', 'Commission Report', 'Commission rows are not exposed as a report query.'),
  unavailable('target-salary', 'payroll', 'Target-based Salary Report', 'Target salary reviews are not exposed as a report query.'),

  { id: 'invoice-report', category: 'billing', name: 'Invoice Report', description: 'Invoices issued in the selected period.', available: true, type: 'INVOICES', filters: ['date', 'status'] },
  { id: 'payment-report', category: 'billing', name: 'Payment Report', description: 'Invoices with status PAID.', available: true, type: 'INVOICES', preset: { status: 'PAID' }, filters: ['date'] },
  { id: 'outstanding', category: 'billing', name: 'Outstanding Payments', description: 'Invoices that are not paid or cancelled.', available: true, type: 'INVOICES', preset: { outstanding: 'true' }, filters: ['date'] },
  { id: 'revenue-report', category: 'billing', name: 'Revenue Report', description: 'Invoice totals in the selected period.', available: true, type: 'REVENUE', filters: ['date'] },
  { id: 'tax-report', category: 'billing', name: 'Tax / GST Report', description: 'Invoice tax amounts stored on each invoice.', available: true, type: 'INVOICES', filters: ['date'] },
  { id: 'customer-registration', category: 'billing', name: 'Customer Registration Report', description: 'Customers created in the selected period.', available: true, type: 'CUSTOMERS', filters: ['date'] },
  { id: 'customer-summary', category: 'billing', name: 'Customer Summary', description: 'Customer records and status.', available: true, type: 'CUSTOMERS', filters: ['status'] },
  unavailable('refund-report', 'billing', 'Refund Report', 'There is no refund ledger to report.'),
  unavailable('subscription-report', 'billing', 'Subscription Report', 'Subscription rows are not exposed through the reports API.'),
  unavailable('subscription-expiry', 'billing', 'Subscription Expiry Report', 'Subscription expiry is not exposed through the reports API.'),
  unavailable('coupon-usage', 'billing', 'Coupon Usage Report', 'Coupon redemptions are not exposed through the reports API.'),

  { id: 'deal-pipeline', category: 'deals', name: 'Deal Pipeline Report', description: 'Open and closed deals with stage and value.', available: true, type: 'DEALS', filters: ['date'] },
  { id: 'deal-stage', category: 'deals', name: 'Deal Stage Report', description: 'Deals filtered by stage name.', available: true, type: 'DEALS', filters: ['date', 'stage'] },
  { id: 'won-lost', category: 'deals', name: 'Won & Lost Deals', description: 'Deals marked won or lost.', available: true, type: 'DEALS', preset: { outcome: 'closed' }, filters: ['date'] },
  { id: 'final-call', category: 'deals', name: 'Final Call Deals', description: 'Deals currently in the Final Call stage.', available: true, type: 'DEALS', preset: { stage: 'Final Call' }, filters: ['date'] },
  { id: 'follow-up-report', category: 'deals', name: 'Follow-up Report', description: 'Leads that have a follow-up date or a logged follow-up.', available: true, type: 'FOLLOWUPS', filters: ['date'] },
  { id: 'upcoming-followups', category: 'deals', name: 'Upcoming Follow-ups', description: 'Follow-ups dated today or later.', available: true, type: 'FOLLOWUPS', preset: { bucket: 'upcoming' }, filters: ['date'] },
  { id: 'overdue-followups', category: 'deals', name: 'Overdue Follow-ups', description: 'Follow-ups whose date has passed.', available: true, type: 'FOLLOWUPS', preset: { bucket: 'overdue' }, filters: ['date'] },
  unavailable('sales-performance', 'deals', 'Sales Performance', 'There is no sales-target attainment dataset for employees.'),

  { id: 'product-report', category: 'inventory', name: 'Product Report', description: 'Products and current stock quantity.', available: true, type: 'PRODUCTS', filters: [] },
  { id: 'low-stock', category: 'inventory', name: 'Low Stock Report', description: 'Products with stock of 5 or less.', available: true, type: 'PRODUCTS', preset: { lowStock: 'true' }, filters: [] },
  unavailable('stock-register', 'inventory', 'Stock Register', 'Stock movements are not stored separately from the product quantity.'),
  unavailable('stock-movement', 'inventory', 'Stock Movement', 'There is no stock-movement ledger.'),
  unavailable('purchase-report', 'inventory', 'Purchase Report', 'There is no purchase-order model.'),
  unavailable('production-summary', 'inventory', 'Production Summary', 'There is no production-order model.'),
  unavailable('production-orders', 'inventory', 'Production Orders', 'There is no production-order model.'),
  unavailable('material-consumption', 'inventory', 'Material Consumption', 'There is no material-consumption model.'),
  unavailable('inventory-valuation', 'inventory', 'Inventory Valuation', 'Valuation is not calculated because cost price is not stored.'),

  { id: 'influencer-directory', category: 'influencer', name: 'Influencer Directory', description: 'Influencer profiles and status.', available: true, type: 'INFLUENCERS', filters: ['status'] },
  { id: 'influencer-approval', category: 'influencer', name: 'Influencer Approval Report', description: 'Influencers filtered by approval status.', available: true, type: 'INFLUENCERS', filters: ['status'] },
  unavailable('influencer-applications', 'influencer', 'Influencer Applications', 'Applications are not a separate report dataset.'),
  unavailable('influencer-booking', 'influencer', 'Influencer Booking Report', 'Bookings are not exposed through the reports API.'),
  unavailable('campaign-performance', 'influencer', 'Campaign Performance', 'Campaign results are not exposed through the reports API.'),
  unavailable('influencer-payment', 'influencer', 'Influencer Payment Report', 'Influencer payments are not exposed through the reports API.'),

  unavailable('ai-usage', 'social', 'AI Usage Report', 'AI provider usage is not stored as a report dataset.'),
  unavailable('social-posts', 'social', 'Social Post Report', 'Published social posts are not exposed through the reports API.'),

  { id: 'revenue-summary', category: 'finance', name: 'Revenue Summary', description: 'Invoice count and total for the period.', available: true, type: 'REVENUE', filters: ['date'] },
  { id: 'payment-collection', category: 'finance', name: 'Payment Collection', description: 'Paid invoices in the period.', available: true, type: 'INVOICES', preset: { status: 'PAID' }, filters: ['date'] },
  { id: 'outstanding-amount', category: 'finance', name: 'Outstanding Amount', description: 'Unpaid invoices.', available: true, type: 'INVOICES', preset: { outstanding: 'true' }, filters: ['date'] },
  unavailable('expense-summary', 'finance', 'Expense Summary', 'There is no general expense ledger.'),
  unavailable('commission-summary', 'finance', 'Commission Summary', 'Commission totals are not exposed through the reports API.'),
  unavailable('financial-transactions', 'finance', 'Financial Transactions', 'There is no general transaction ledger.'),

  { id: 'admin-activity', category: 'system', name: 'Admin Activity Logs', description: 'Audit log entries for the tenant.', available: true, type: 'AUDIT', filters: ['date'] },
  { id: 'user-activity', category: 'system', name: 'User Activity Report', description: 'Audit log entries with user and module.', available: true, type: 'AUDIT', filters: ['date'] },
  unavailable('login-history', 'system', 'Login History', 'Sessions are not exposed as a report.'),
  unavailable('integration-status', 'system', 'Integration Status Report', 'Integration settings are not included in report exports.'),
  unavailable('notification-delivery', 'system', 'Notification Delivery Report', 'Notification delivery results are not aggregated for reports.'),
  unavailable('data-capture-report', 'system', 'Data Capture Report', 'Data-capture jobs are not included in the reports API.'),
  unavailable('api-usage', 'system', 'API Usage Report', 'API usage is not stored as a report dataset.'),

  { id: 'leave-report', category: 'other', name: 'Leave Report', description: 'Leave requests in the selected period.', available: true, type: 'LEAVES', filters: ['date', 'status'] },
];

export function reportById(id: string) {
  return REPORT_CATALOG.find((report) => report.id === id) || null;
}
