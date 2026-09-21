export interface PermissionItem {
  module: string;
  action: string;
}

export const ALL_STANDARD_MODULES = [
  'LEADS',
  'FOLLOW_UP',
  'VISITS',
  'ATTENDANCE',
  'LEAVE',
  'TASKS',
  'SALARY',
  'LOAN',
  'REPORTS',
  'SETTINGS',
] as const;

export type StandardModule = typeof ALL_STANDARD_MODULES[number];

export const STANDARD_PERMISSIONS: { module: string; action: string; description: string }[] = [
  // LEADS
  { module: 'LEADS', action: 'VIEW', description: 'View CRM leads and details' },
  { module: 'LEADS', action: 'CREATE', description: 'Create new CRM leads' },
  { module: 'LEADS', action: 'EDIT', description: 'Edit and update CRM leads' },
  { module: 'LEADS', action: 'DELETE', description: 'Delete CRM leads' },

  // FOLLOW_UP
  { module: 'FOLLOW_UP', action: 'VIEW', description: 'View follow-up schedules and logs' },
  { module: 'FOLLOW_UP', action: 'CREATE', description: 'Log new follow-ups' },
  { module: 'FOLLOW_UP', action: 'EDIT', description: 'Update existing follow-ups' },
  { module: 'FOLLOW_UP', action: 'DELETE', description: 'Delete follow-ups' },

  // VISITS
  { module: 'VISITS', action: 'VIEW', description: 'View scheduled client visits' },
  { module: 'VISITS', action: 'CREATE', description: 'Schedule new client visits' },
  { module: 'VISITS', action: 'EDIT', description: 'Start, complete, or update visits' },
  { module: 'VISITS', action: 'DELETE', description: 'Cancel or delete visits' },

  // ATTENDANCE
  { module: 'ATTENDANCE', action: 'VIEW', description: 'View attendance status and history' },
  { module: 'ATTENDANCE', action: 'CREATE', description: 'Punch in/out attendance' },
  { module: 'ATTENDANCE', action: 'EDIT', description: 'Regularize or edit attendance' },
  { module: 'ATTENDANCE', action: 'DELETE', description: 'Delete attendance logs' },

  // LEAVE
  { module: 'LEAVE', action: 'VIEW', description: 'View leaves and requests' },
  { module: 'LEAVE', action: 'CREATE', description: 'Apply for leaves and requests' },
  { module: 'LEAVE', action: 'EDIT', description: 'Approve or update leaves' },
  { module: 'LEAVE', action: 'DELETE', description: 'Cancel or delete leave requests' },

  // TASKS
  { module: 'TASKS', action: 'VIEW', description: 'View assigned tasks' },
  { module: 'TASKS', action: 'CREATE', description: 'Create new tasks' },
  { module: 'TASKS', action: 'EDIT', description: 'Update task status and details' },
  { module: 'TASKS', action: 'DELETE', description: 'Delete tasks' },

  // SALARY
  { module: 'SALARY', action: 'VIEW', description: 'View salary slips and payroll' },

  // LOAN
  { module: 'LOAN', action: 'VIEW', description: 'View loan advances' },
  { module: 'LOAN', action: 'CREATE', description: 'Request loan advance' },

  // REPORTS
  { module: 'REPORTS', action: 'VIEW', description: 'View CRM and HRM analytical reports' },

  // SETTINGS
  { module: 'SETTINGS', action: 'VIEW', description: 'View account and app settings' },
  { module: 'SETTINGS', action: 'EDIT', description: 'Modify account and app settings' },
];

export const ROLE_PERMISSION_DEFAULTS: Record<string, PermissionItem[]> = {
  SUPER_ADMIN: STANDARD_PERMISSIONS.map((p) => ({ module: p.module, action: p.action })),
  COMPANY_ADMIN: STANDARD_PERMISSIONS.map((p) => ({ module: p.module, action: p.action })),
  TELECALLER: [
    { module: 'LEADS', action: 'VIEW' },
    { module: 'LEADS', action: 'CREATE' },
    { module: 'LEADS', action: 'EDIT' },
    { module: 'FOLLOW_UP', action: 'VIEW' },
    { module: 'FOLLOW_UP', action: 'CREATE' },
  ],
  SALES_EXECUTIVE: [
    { module: 'LEADS', action: 'VIEW' },
    { module: 'LEADS', action: 'CREATE' },
    { module: 'LEADS', action: 'EDIT' },
    { module: 'FOLLOW_UP', action: 'VIEW' },
    { module: 'FOLLOW_UP', action: 'CREATE' },
    { module: 'FOLLOW_UP', action: 'EDIT' },
    { module: 'VISITS', action: 'VIEW' },
    { module: 'VISITS', action: 'CREATE' },
    { module: 'VISITS', action: 'EDIT' },
    { module: 'TASKS', action: 'VIEW' },
    { module: 'TASKS', action: 'EDIT' },
  ],
  HR: [
    { module: 'ATTENDANCE', action: 'VIEW' },
    { module: 'ATTENDANCE', action: 'CREATE' },
    { module: 'ATTENDANCE', action: 'EDIT' },
    { module: 'ATTENDANCE', action: 'DELETE' },
    { module: 'LEAVE', action: 'VIEW' },
    { module: 'LEAVE', action: 'CREATE' },
    { module: 'LEAVE', action: 'EDIT' },
    { module: 'LEAVE', action: 'DELETE' },
    { module: 'SALARY', action: 'VIEW' },
    { module: 'REPORTS', action: 'VIEW' },
  ],
  EMPLOYEE: [
    { module: 'ATTENDANCE', action: 'VIEW' },
    { module: 'ATTENDANCE', action: 'CREATE' },
    { module: 'LEAVE', action: 'VIEW' },
    { module: 'LEAVE', action: 'CREATE' },
    { module: 'TASKS', action: 'VIEW' },
    { module: 'TASKS', action: 'EDIT' },
    { module: 'SALARY', action: 'VIEW' },
    { module: 'VISITS', action: 'VIEW' },
  ],
  MANAGER: [
    { module: 'LEADS', action: 'VIEW' },
    { module: 'LEADS', action: 'CREATE' },
    { module: 'LEADS', action: 'EDIT' },
    { module: 'LEADS', action: 'DELETE' },
    { module: 'FOLLOW_UP', action: 'VIEW' },
    { module: 'FOLLOW_UP', action: 'CREATE' },
    { module: 'FOLLOW_UP', action: 'EDIT' },
    { module: 'FOLLOW_UP', action: 'DELETE' },
    { module: 'VISITS', action: 'VIEW' },
    { module: 'VISITS', action: 'CREATE' },
    { module: 'VISITS', action: 'EDIT' },
    { module: 'VISITS', action: 'DELETE' },
    { module: 'ATTENDANCE', action: 'VIEW' },
    { module: 'ATTENDANCE', action: 'CREATE' },
    { module: 'ATTENDANCE', action: 'EDIT' },
    { module: 'LEAVE', action: 'VIEW' },
    { module: 'LEAVE', action: 'CREATE' },
    { module: 'LEAVE', action: 'EDIT' },
    { module: 'TASKS', action: 'VIEW' },
    { module: 'TASKS', action: 'CREATE' },
    { module: 'TASKS', action: 'EDIT' },
    { module: 'REPORTS', action: 'VIEW' },
  ],
};
