export type WhereKind =
  | 'customer'
  | 'attendance'
  | 'lead'
  | 'task'
  | 'contact'
  | 'quotation'
  | 'work'
  | 'ticket'
  | 'generation'
  | 'invoice'
  | 'template';

export type TableRule = {
  model: string;
  table: string;
  label: string;
  where: WhereKind;
};

export type ResetModule = {
  id: string;
  name: string;
  description: string;
  available: boolean;
  reason?: string;
  tables: TableRule[];
};

export const PROTECTED_RECORDS = [
  'Admin and user accounts',
  'Authentication sessions are not part of a data reset',
  'Roles and permissions',
  'Tenant and organization records',
  'Departments, designations, and employees',
  'Salary structures and payroll policies',
  'Integration credentials and payment settings',
  'Subscription plans',
  'Audit logs',
  'Prisma migration history',
  'System email and WhatsApp templates',
];

export const FORBIDDEN_MODELS = [
  'user',
  'role',
  'permission',
  'userRole',
  'rolePermission',
  'customer',
  'plan',
  'customerSubscription',
  'integrationSetting',
  'paymentSetting',
  'department',
  'designation',
  'employee',
  'salaryStructure',
  'auditLog',
  'refreshToken',
  'session',
];

const row = (model: string, table: string, label: string, where: WhereKind): TableRule => ({ model, table, label, where });

export const RESET_MODULES: ResetModule[] = [
  {
    id: 'hrm',
    name: 'HRM',
    description: 'Attendance, leave, remote work, overtime, and location logs for this tenant.',
    available: true,
    tables: [
      row('overtimeApproval', 'OvertimeApproval', 'Overtime approvals', 'customer'),
      row('overtimeRequest', 'OvertimeRequest', 'Overtime requests', 'customer'),
      row('attendanceBreak', 'AttendanceBreak', 'Attendance breaks', 'attendance'),
      row('attendance', 'Attendance', 'Attendance', 'customer'),
      row('remoteRequest', 'RemoteRequest', 'Remote work requests', 'customer'),
      row('employeeLocation', 'EmployeeLocation', 'Location logs', 'customer'),
      row('locationTrackingSetting', 'LocationTrackingSetting', 'Location tracking settings', 'customer'),
      row('leaveAdjustmentHistory', 'LeaveAdjustmentHistory', 'Leave adjustments', 'customer'),
      row('employeeLeaveBalance', 'EmployeeLeaveBalance', 'Leave balances', 'customer'),
      row('leaveRequest', 'LeaveRequest', 'Leave requests', 'customer'),
    ],
  },
  {
    id: 'sales-crm',
    name: 'Sales & CRM',
    description: 'Leads, deals, quotations, contacts, and CRM companies. Tenant accounts stay.',
    available: true,
    tables: [
      row('leadActivityTimeline', 'LeadActivityTimeline', 'Lead timeline', 'lead'),
      row('leadNote', 'LeadNote', 'Lead notes', 'lead'),
      row('leadReminder', 'LeadReminder', 'Lead reminders', 'lead'),
      row('leadStatusHistory', 'LeadStatusHistory', 'Lead status history', 'lead'),
      row('leadImage', 'lead_images', 'Lead images', 'lead'),
      row('leadSocialProfile', 'lead_social_profiles', 'Lead social profiles', 'lead'),
      row('communicationHistory', 'CommunicationHistory', 'Contact communication', 'contact'),
      row('quotationItem', 'QuotationItem', 'Quotation items', 'quotation'),
      row('quotation', 'Quotation', 'Quotations', 'customer'),
      row('deal', 'Deal', 'Deals', 'customer'),
      row('contact', 'Contact', 'Contacts', 'customer'),
      row('lead', 'Lead', 'Leads', 'customer'),
      row('company', 'Company', 'CRM companies', 'customer'),
    ],
  },
  {
    id: 'customers',
    name: 'Customers',
    description: 'CRM companies and contacts only. The tenant organization record is protected.',
    available: true,
    tables: [
      row('communicationHistory', 'CommunicationHistory', 'Contact communication', 'contact'),
      row('contact', 'Contact', 'Contacts', 'customer'),
      row('company', 'Company', 'CRM companies', 'customer'),
    ],
  },
  {
    id: 'leads-deals',
    name: 'Leads & Deals',
    description: 'Lead records, deals, and quotations. CRM companies stay unless Customers is also selected.',
    available: true,
    tables: [
      row('leadActivityTimeline', 'LeadActivityTimeline', 'Lead timeline', 'lead'),
      row('leadNote', 'LeadNote', 'Lead notes', 'lead'),
      row('leadReminder', 'LeadReminder', 'Lead reminders', 'lead'),
      row('leadStatusHistory', 'LeadStatusHistory', 'Lead status history', 'lead'),
      row('leadImage', 'lead_images', 'Lead images', 'lead'),
      row('leadSocialProfile', 'lead_social_profiles', 'Lead social profiles', 'lead'),
      row('quotationItem', 'QuotationItem', 'Quotation items', 'quotation'),
      row('quotation', 'Quotation', 'Quotations', 'customer'),
      row('deal', 'Deal', 'Deals', 'customer'),
      row('lead', 'Lead', 'Leads', 'customer'),
    ],
  },
  {
    id: 'visits-tasks',
    name: 'Visits & Tasks',
    description: 'Field visits, tasks, work items, schedules, and support tickets.',
    available: true,
    tables: [
      row('taskHistory', 'TaskHistory', 'Task history', 'task'),
      row('taskProof', 'TaskProof', 'Task proof', 'task'),
      row('taskReview', 'TaskReview', 'Task reviews', 'task'),
      row('workTask', 'WorkTask', 'Work tasks', 'work'),
      row('ticketComment', 'TicketComment', 'Ticket comments', 'ticket'),
      row('visit', 'Visit', 'Visits', 'customer'),
      row('task', 'Task', 'Tasks', 'customer'),
      row('workAccessRequest', 'work_access_requests', 'Work access requests', 'customer'),
      row('monthlySchedule', 'monthly_schedules', 'Schedules', 'customer'),
      row('work', 'Work', 'Work items', 'customer'),
      row('supportTicket', 'SupportTicket', 'Support tickets', 'customer'),
    ],
  },
  {
    id: 'data-capture',
    name: 'Data Capture',
    description: 'Captured places, searches, and capture jobs for this tenant.',
    available: true,
    tables: [
      row('dataCapturePlace', 'DataCapturePlace', 'Captured places', 'customer'),
      row('dataCaptureSearch', 'DataCaptureSearch', 'Capture searches', 'customer'),
      row('dataCaptureJob', 'DataCaptureJob', 'Capture jobs', 'customer'),
    ],
  },
  {
    id: 'content',
    name: 'Content Management',
    description: 'Banners, videos, and trending content owned by this tenant.',
    available: true,
    tables: [
      row('customerMarketingVideoView', 'customer_marketing_video_views', 'Video views', 'customer'),
      row('marketingVideo', 'marketing_videos', 'Marketing videos', 'customer'),
      row('marketingBanner', 'marketing_banners', 'Banners', 'customer'),
      row('trendingContent', 'trending_contents', 'Trending content', 'customer'),
    ],
  },
  {
    id: 'ai-social',
    name: 'AI & Social',
    description: 'AI generations and connected social posts. Credit wallet configuration stays.',
    available: true,
    tables: [
      row('aiGenerationAsset', 'ai_generation_assets', 'AI generation files', 'generation'),
      row('aiGeneration', 'ai_generations', 'AI generations', 'customer'),
      row('aiCreditTransaction', 'ai_credit_transactions', 'AI credit transactions', 'customer'),
      row('socialPublish', 'social_publishes', 'Social posts', 'customer'),
      row('socialAccount', 'social_accounts', 'Social accounts', 'customer'),
      row('socialMediaHandler', 'social_media_handlers', 'Social handlers', 'customer'),
    ],
  },
  {
    id: 'reports',
    name: 'Reports Data',
    description: 'Reports are calculated from live records.',
    available: false,
    reason: 'There is no stored report table. Report pages read attendance, payroll, leads, and related records directly.',
    tables: [],
  },
  {
    id: 'influencer',
    name: 'Influencer Management',
    description: 'Bookings and reviews for this tenant. Marketplace influencer profiles stay.',
    available: true,
    tables: [
      row('influencerBookingPayment', 'influencer_booking_payments', 'Booking payments', 'customer'),
      row('influencerReview', 'influencer_reviews', 'Influencer reviews', 'customer'),
      row('influencerBooking', 'influencer_bookings', 'Influencer bookings', 'customer'),
    ],
  },
  {
    id: 'templates',
    name: 'Templates',
    description: 'Tenant email and WhatsApp templates. System templates stay.',
    available: true,
    tables: [
      row('emailLog', 'email_logs', 'Email logs', 'customer'),
      row('emailTemplate', 'email_templates', 'Email templates', 'template'),
      row('metaTemplate', 'meta_templates', 'WhatsApp templates', 'template'),
    ],
  },
  {
    id: 'notifications',
    name: 'Notifications',
    description: 'Tenant notifications. Shared campaign definitions are not tenant-owned and stay.',
    available: true,
    tables: [row('notification', 'Notification', 'Notifications', 'customer')],
  },
  {
    id: 'payroll',
    name: 'Payroll Transactions',
    description: 'Payroll runs, items, and salary slips. Registered salary structures stay.',
    available: true,
    tables: [
      row('salarySlip', 'SalarySlip', 'Salary slips', 'customer'),
      row('payrollItem', 'PayrollItem', 'Payroll items', 'customer'),
      row('payroll', 'Payroll', 'Payroll runs', 'customer'),
    ],
  },
  {
    id: 'attendance',
    name: 'Attendance',
    description: 'Attendance punches and breaks for this tenant.',
    available: true,
    tables: [
      row('attendanceBreak', 'AttendanceBreak', 'Attendance breaks', 'attendance'),
      row('attendance', 'Attendance', 'Attendance', 'customer'),
    ],
  },
  {
    id: 'leave',
    name: 'Leave Management',
    description: 'Leave requests, balances, and adjustments. Leave types and policies stay.',
    available: true,
    tables: [
      row('leaveAdjustmentHistory', 'LeaveAdjustmentHistory', 'Leave adjustments', 'customer'),
      row('employeeLeaveBalance', 'EmployeeLeaveBalance', 'Leave balances', 'customer'),
      row('leaveRequest', 'LeaveRequest', 'Leave requests', 'customer'),
    ],
  },
  {
    id: 'expenses',
    name: 'Expenses and Claims',
    description: 'Employee claims and loans. These are removed only when this module is explicitly selected.',
    available: true,
    tables: [
      row('employeeClaim', 'EmployeeClaim', 'Claims', 'customer'),
      row('employeeLoan', 'EmployeeLoan', 'Loans', 'customer'),
    ],
  },
  {
    id: 'billing',
    name: 'Billing transactions',
    description: 'Invoices, payments, and installments. Plans and the tenant subscription record stay.',
    available: true,
    tables: [
      row('invoiceItem', 'InvoiceItem', 'Invoice items', 'invoice'),
      row('invoice', 'Invoice', 'Invoices', 'customer'),
      row('paymentHistory', 'PaymentHistory', 'Payments', 'customer'),
      row('subscriptionInstallment', 'subscription_installments', 'Installments', 'customer'),
      row('customPlanOrder', 'custom_plan_orders', 'Custom plan orders', 'customer'),
    ],
  },
];

const MODULE_ALIASES: Record<string, string> = {
  crm: 'sales-crm',
  claims: 'expenses',
  loans: 'expenses',
  works: 'visits-tasks',
  location: 'hrm',
  remote: 'hrm',
};

export function resolveModuleId(id: string): string {
  const key = String(id || '').trim().toLowerCase();
  return MODULE_ALIASES[key] || key;
}

export function moduleById(id: string): ResetModule | undefined {
  return RESET_MODULES.find((item) => item.id === resolveModuleId(id));
}

export function availableModules(): ResetModule[] {
  return RESET_MODULES.filter((item) => item.available);
}

export function tablesForModules(ids: string[]): TableRule[] {
  const seen = new Set<string>();
  const tables: TableRule[] = [];
  ids.forEach((id) => {
    const module = moduleById(id);
    module?.tables.forEach((table) => {
      if (seen.has(table.model)) return;
      seen.add(table.model);
      tables.push(table);
    });
  });
  return tables;
}

export function whereFor(kind: WhereKind, customerId: number | null): Record<string, unknown> {
  if (customerId == null) {
    if (kind === 'template') return { isSystem: false };
    return {};
  }
  switch (kind) {
    case 'customer':
      return { customerId };
    case 'template':
      return { customerId, isSystem: false };
    case 'attendance':
      return { attendance: { customerId } };
    case 'lead':
      return { lead: { customerId } };
    case 'task':
      return { task: { customerId } };
    case 'contact':
      return { contact: { customerId } };
    case 'quotation':
      return { quotation: { customerId } };
    case 'work':
      return { work: { customerId } };
    case 'ticket':
      return { ticket: { customerId } };
    case 'generation':
      return { generation: { customerId } };
    case 'invoice':
      return { invoice: { customerId } };
    default:
      return { customerId };
  }
}

export function assertCatalogSafe(): void {
  const models = RESET_MODULES.flatMap((item) => item.tables.map((table) => table.model));
  const blocked = models.filter((model) => FORBIDDEN_MODELS.includes(model));
  if (blocked.length) {
    throw new Error(`Reset catalog includes protected models: ${blocked.join(', ')}`);
  }
}
