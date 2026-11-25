export type ExportColumnType = 'string' | 'number' | 'currency' | 'date' | 'datetime' | 'status' | 'phone';

export interface ExportColumnDef {
  key: string;
  label: string;
  type?: ExportColumnType;
  width?: number;
  defaultVisible?: boolean;
}

export interface ExportModuleSchema {
  module: string;
  title: string;
  sheetName: string;
  defaultOrientation: 'portrait' | 'landscape';
  supportsZip?: boolean;
  columns: ExportColumnDef[];
}

export const SENSITIVE_EXPORT_KEYS = [
  'password',
  'passwordhash',
  'accesstoken',
  'refreshtoken',
  'token',
  'secret',
  'privatekey',
  'apikey',
  'otp',
  'otpcode',
  'credentials',
  'sessiontoken',
];

export function isSensitiveExportKey(key: string): boolean {
  const lower = String(key || '').toLowerCase();
  return SENSITIVE_EXPORT_KEYS.some((s) => lower.includes(s));
}

export const EXPORT_MODULE_SCHEMAS: Record<string, ExportModuleSchema> = {
  leads: {
    module: 'leads',
    title: 'CRM Leads Report',
    sheetName: 'CRM Leads',
    defaultOrientation: 'landscape',
    supportsZip: true,
    columns: [
      { key: 'id', label: 'Lead ID', type: 'number', width: 10 },
      { key: 'businessName', label: 'Business / Lead Name', type: 'string', width: 28 },
      { key: 'contactPerson', label: 'Contact Person', type: 'string', width: 20 },
      { key: 'phone', label: 'Phone', type: 'phone', width: 16 },
      { key: 'email', label: 'Email', type: 'string', width: 24 },
      { key: 'city', label: 'City', type: 'string', width: 14 },
      { key: 'category', label: 'Category', type: 'string', width: 18 },
      { key: 'source', label: 'Source', type: 'status', width: 15 },
      { key: 'stage', label: 'Current Stage', type: 'status', width: 18 },
      { key: 'assignedTo', label: 'Assigned Employee', type: 'string', width: 20 },
      { key: 'estimatedValue', label: 'Est. Value (INR)', type: 'currency', width: 16 },
      { key: 'createdAt', label: 'Created Date', type: 'datetime', width: 20 },
    ],
  },
  deals: {
    module: 'deals',
    title: 'CRM Deals Pipeline Report',
    sheetName: 'CRM Deals',
    defaultOrientation: 'landscape',
    columns: [
      { key: 'id', label: 'Deal ID', type: 'number', width: 10 },
      { key: 'title', label: 'Deal Title', type: 'string', width: 28 },
      { key: 'leadName', label: 'Lead / Business', type: 'string', width: 24 },
      { key: 'stage', label: 'Stage', type: 'status', width: 18 },
      { key: 'value', label: 'Deal Value (INR)', type: 'currency', width: 18 },
      { key: 'ownerName', label: 'Owner', type: 'string', width: 20 },
      { key: 'expectedCloseDate', label: 'Expected Close', type: 'date', width: 15 },
      { key: 'createdAt', label: 'Created Date', type: 'datetime', width: 20 },
    ],
  },
  customers: {
    module: 'customers',
    title: 'Customers Directory Report',
    sheetName: 'Customers',
    defaultOrientation: 'landscape',
    columns: [
      { key: 'id', label: 'Customer ID', type: 'number', width: 12 },
      { key: 'name', label: 'Customer Name', type: 'string', width: 24 },
      { key: 'companyName', label: 'Company', type: 'string', width: 26 },
      { key: 'email', label: 'Email', type: 'string', width: 24 },
      { key: 'phone', label: 'Phone', type: 'phone', width: 16 },
      { key: 'city', label: 'City', type: 'string', width: 15 },
      { key: 'status', label: 'Status', type: 'status', width: 14 },
      { key: 'createdAt', label: 'Registered On', type: 'datetime', width: 20 },
    ],
  },
  invoices: {
    module: 'invoices',
    title: 'Invoices & Billing Report',
    sheetName: 'Invoices',
    defaultOrientation: 'landscape',
    supportsZip: true,
    columns: [
      { key: 'invoiceNo', label: 'Invoice #', type: 'string', width: 20 },
      { key: 'customerName', label: 'Customer', type: 'string', width: 24 },
      { key: 'planName', label: 'Plan / Service', type: 'string', width: 22 },
      { key: 'issueDate', label: 'Invoice Date', type: 'date', width: 14 },
      { key: 'dueDate', label: 'Due Date', type: 'date', width: 14 },
      { key: 'subTotal', label: 'Subtotal (INR)', type: 'currency', width: 16 },
      { key: 'taxAmount', label: 'Tax (INR)', type: 'currency', width: 14 },
      { key: 'totalAmount', label: 'Total (INR)', type: 'currency', width: 16 },
      { key: 'paidAmount', label: 'Paid (INR)', type: 'currency', width: 16 },
      { key: 'balanceAmount', label: 'Balance (INR)', type: 'currency', width: 16 },
      { key: 'paymentMode', label: 'Payment Mode', type: 'status', width: 14 },
      { key: 'status', label: 'Status', type: 'status', width: 16 },
    ],
  },
  employees: {
    module: 'employees',
    title: 'Employee Directory Report',
    sheetName: 'Employees',
    defaultOrientation: 'landscape',
    columns: [
      { key: 'employeeCode', label: 'Emp Code', type: 'string', width: 14 },
      { key: 'fullName', label: 'Employee Name', type: 'string', width: 24 },
      { key: 'email', label: 'Email', type: 'string', width: 24 },
      { key: 'phone', label: 'Phone', type: 'phone', width: 16 },
      { key: 'department', label: 'Department', type: 'string', width: 18 },
      { key: 'designation', label: 'Designation', type: 'string', width: 18 },
      { key: 'branch', label: 'Branch / Office', type: 'string', width: 16 },
      { key: 'joiningDate', label: 'Joining Date', type: 'date', width: 14 },
      { key: 'status', label: 'Status', type: 'status', width: 12 },
    ],
  },
  attendance: {
    module: 'attendance',
    title: 'Attendance Register Report',
    sheetName: 'Attendance',
    defaultOrientation: 'landscape',
    columns: [
      { key: 'date', label: 'Date', type: 'date', width: 14 },
      { key: 'employeeCode', label: 'Emp Code', type: 'string', width: 14 },
      { key: 'employeeName', label: 'Employee', type: 'string', width: 22 },
      { key: 'department', label: 'Department', type: 'string', width: 16 },
      { key: 'punchIn', label: 'Punch In', type: 'datetime', width: 18 },
      { key: 'punchOut', label: 'Punch Out', type: 'datetime', width: 18 },
      { key: 'workingHours', label: 'Hours', type: 'number', width: 10 },
      { key: 'lateMinutes', label: 'Late (mins)', type: 'number', width: 12 },
      { key: 'status', label: 'Status', type: 'status', width: 14 },
    ],
  },
  leaves: {
    module: 'leaves',
    title: 'Leave Requests Report',
    sheetName: 'Leaves',
    defaultOrientation: 'landscape',
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 10 },
      { key: 'employeeName', label: 'Employee', type: 'string', width: 22 },
      { key: 'leaveType', label: 'Leave Type', type: 'string', width: 16 },
      { key: 'startDate', label: 'From Date', type: 'date', width: 14 },
      { key: 'endDate', label: 'To Date', type: 'date', width: 14 },
      { key: 'totalDays', label: 'Days', type: 'number', width: 10 },
      { key: 'reason', label: 'Reason', type: 'string', width: 26 },
      { key: 'status', label: 'Status', type: 'status', width: 14 },
    ],
  },
  announcements: {
    module: 'announcements',
    title: 'Company Announcements Report',
    sheetName: 'Announcements',
    defaultOrientation: 'landscape',
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 8 },
      { key: 'title', label: 'Title', type: 'string', width: 28 },
      { key: 'description', label: 'Description', type: 'string', width: 36 },
      { key: 'category', label: 'Category', type: 'status', width: 14 },
      { key: 'audience', label: 'Audience', type: 'status', width: 14 },
      { key: 'departmentName', label: 'Department', type: 'string', width: 16 },
      { key: 'publishAt', label: 'Published At', type: 'datetime', width: 20 },
      { key: 'expiresAt', label: 'Expiry At', type: 'datetime', width: 20 },
      { key: 'status', label: 'Status', type: 'status', width: 14 },
    ],
  },
  ssm_access: {
    module: 'ssm_access',
    title: 'SSM Account Access Report',
    sheetName: 'SSM Handlers',
    defaultOrientation: 'landscape',
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 8 },
      { key: 'handlerName', label: 'Handler Name', type: 'string', width: 22 },
      { key: 'handlerEmail', label: 'Handler Email', type: 'string', width: 24 },
      { key: 'handlerPhone', label: 'Handler Phone', type: 'phone', width: 16 },
      { key: 'accountName', label: 'Account Name', type: 'string', width: 20 },
      { key: 'platform', label: 'Platform', type: 'status', width: 14 },
      { key: 'customerName', label: 'Client / Company', type: 'string', width: 22 },
      { key: 'status', label: 'Status', type: 'status', width: 12 },
    ],
  },
  audit_logs: {
    module: 'audit_logs',
    title: 'System Audit Logs Report',
    sheetName: 'Audit Logs',
    defaultOrientation: 'landscape',
    columns: [
      { key: 'id', label: 'Log ID', type: 'number', width: 10 },
      { key: 'userName', label: 'User', type: 'string', width: 20 },
      { key: 'userRole', label: 'Role', type: 'status', width: 14 },
      { key: 'action', label: 'Action', type: 'status', width: 14 },
      { key: 'module', label: 'Module', type: 'string', width: 16 },
      { key: 'description', label: 'Description', type: 'string', width: 36 },
      { key: 'createdAt', label: 'Timestamp', type: 'datetime', width: 20 },
    ],
  },
};
