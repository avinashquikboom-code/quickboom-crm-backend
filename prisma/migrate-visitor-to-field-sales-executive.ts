import { PrismaClient, RoleType } from '@prisma/client';

const prisma = new PrismaClient();

export async function migrateVisitorToFieldSalesExecutive() {
  console.log('--- Migrating Visitor to Field Sales Executive ---');

  // 1. Update Designations
  const updatedDesigs = await prisma.designation.updateMany({
    where: {
      OR: [
        { code: 'VISITOR' },
        { name: { contains: 'visitor', mode: 'insensitive' } },
      ],
    },
    data: {
      name: 'Field Sales Executive',
      code: 'FIELD_SALES_EXECUTIVE',
      description: 'On-site field sales & client visit execution',
    },
  });
  console.log(`Updated ${updatedDesigs.count} designation(s).`);

  // 2. Update Roles
  const updatedRoles = await prisma.role.updateMany({
    where: {
      OR: [
        { name: { contains: 'visitor', mode: 'insensitive' } },
        { description: { contains: 'visitor', mode: 'insensitive' } },
      ],
    },
    data: {
      name: 'Field Sales Executive',
      description: 'Field Sales Executive for on-site client visits and execution',
    },
  });
  console.log(`Updated ${updatedRoles.count} role(s).`);

  // 3. Ensure canonical Field Sales Executive role exists
  let fseRole = await prisma.role.findFirst({
    where: {
      OR: [
        { name: 'Field Sales Executive' },
        { name: 'FIELD_SALES_EXECUTIVE' },
      ],
    },
  });
  if (!fseRole) {
    fseRole = await prisma.role.create({
      data: {
        name: 'Field Sales Executive',
        type: RoleType.CUSTOM,
        description: 'Field Sales Executive for on-site client visits and execution',
      },
    });
    console.log(`Created Field Sales Executive role with ID: ${fseRole.id}`);
  } else {
    console.log(`Found Field Sales Executive role with ID: ${fseRole.id}`);
  }
}

if (require.main === module) {
  migrateVisitorToFieldSalesExecutive()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error(err);
      prisma.$disconnect();
      process.exit(1);
    });
}
