import { PrismaClient, RoleType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@quikboom.com';
  const password = '123456';
  const hashedPassword = await bcrypt.hash(password, 10);

  // 1. Ensure SUPER_ADMIN role exists
  let superAdminRole = await prisma.role.findFirst({
    where: { type: RoleType.SUPER_ADMIN },
  });

  if (!superAdminRole) {
    superAdminRole = await prisma.role.create({
      data: {
        name: 'Super Administrator',
        type: RoleType.SUPER_ADMIN,
        description: 'Full administrative platform access',
      },
    });
  }

  // 2. Find or Create User
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  let user = existingUser;

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        phone: '+1-555-0100',
        firstName: 'Super',
        lastName: 'Admin',
        passwordHash: hashedPassword,
        isVerified: true,
      },
    });
    console.log(`✅ Created Super Admin user (${email} / ${password})`);
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: 'Super',
        lastName: 'Admin',
        passwordHash: hashedPassword,
      },
    });
    console.log(`✅ Updated name to Super Admin and refreshed credentials for (${email})`);
  }

  // 3. Assign SUPER_ADMIN role to user
  await prisma.userRole.deleteMany({
    where: { userId: user.id },
  });

  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: superAdminRole.id,
    },
  });

  // 4. Update any existing roles named 'Customer Administrator' to avoid stale states
  await prisma.role.updateMany({
    where: { name: 'Customer Administrator' },
    data: { type: RoleType.SUPER_ADMIN },
  });

  console.log(`✅ Assigned role SUPER_ADMIN to ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
