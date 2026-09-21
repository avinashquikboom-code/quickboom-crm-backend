import { PrismaClient, RoleType } from '@prisma/client';

const prisma = new PrismaClient();

export const STANDARD_PERMISSIONS = [
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

export const ROLE_PERMISSION_DEFAULTS: Record<string, { module: string; action: string }[]> = {
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

export async function seedRbac() {
  console.log('--- Starting RBAC Seeding ---');

  // 1. Seed standard permissions
  const permMap = new Map<string, number>();
  for (const perm of STANDARD_PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: {
        module_action: {
          module: perm.module,
          action: perm.action,
        },
      },
      update: {
        description: perm.description,
      },
      create: {
        module: perm.module,
        action: perm.action,
        description: perm.description,
      },
    });
    permMap.set(`${perm.module}:${perm.action}`, record.id);
  }
  console.log(`Seeded ${permMap.size} standard permissions.`);

  // 2. Ensure standard roles exist
  const rolesToEnsure = [
    { name: 'SUPER_ADMIN', type: RoleType.SUPER_ADMIN, desc: 'Full administrative access' },
    { name: 'COMPANY_ADMIN', type: RoleType.CUSTOMER_ADMIN, desc: 'Company Administrator' },
    { name: 'TELECALLER', type: RoleType.CUSTOM, desc: 'Telecaller role for CRM calling and lead capture' },
    { name: 'SALES_EXECUTIVE', type: RoleType.CUSTOM, desc: 'Sales Executive for on-ground visits and leads' },
    { name: 'HR', type: RoleType.CUSTOM, desc: 'HR Manager/Executive' },
    { name: 'EMPLOYEE', type: RoleType.CUSTOM, desc: 'General Employee role' },
    { name: 'MANAGER', type: RoleType.CUSTOM, desc: 'Department/Team Manager' },
  ];

  for (const r of rolesToEnsure) {
    let roleRecord = await prisma.role.findFirst({
      where: {
        name: r.name,
        deletedAt: null,
      },
    });

    if (!roleRecord) {
      roleRecord = await prisma.role.create({
        data: {
          name: r.name,
          type: r.type,
          description: r.desc,
        },
      });
      console.log(`Created role ${r.name} with ID ${roleRecord.id}`);
    }

    // Assign default role permissions if none exist
    const currentPermCount = await prisma.rolePermission.count({
      where: { roleId: roleRecord.id },
    });

    if (currentPermCount === 0 && ROLE_PERMISSION_DEFAULTS[r.name]) {
      const permsToAssign = ROLE_PERMISSION_DEFAULTS[r.name];
      for (const p of permsToAssign) {
        const pId = permMap.get(`${p.module}:${p.action}`);
        if (pId) {
          await prisma.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: roleRecord.id,
                permissionId: pId,
              },
            },
            update: {},
            create: {
              roleId: roleRecord.id,
              permissionId: pId,
            },
          });
        }
      }
      console.log(`Assigned ${permsToAssign.length} permissions to role ${r.name}`);
    }
  }

  console.log('--- RBAC Seeding Completed ---');
}

if (require.main === module) {
  seedRbac()
    .catch((e) => {
      console.error('RBAC Seeding error:', e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
