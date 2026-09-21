import { PrismaClient, RoleType } from '@prisma/client';
import { STANDARD_PERMISSIONS, ROLE_PERMISSION_DEFAULTS } from '../src/common/constants/rbac.constants';

const prisma = new PrismaClient();

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
