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

  // 4. Ensure default customer exists and is active
  let customer = await prisma.customer.findFirst({
    where: { name: 'QuikBoom Enterprise' },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        name: 'QuikBoom Enterprise',
        email: 'info@quikboom.com',
        isActive: true,
        customerType: 'ENTERPRISE',
      },
    });
  } else if (!customer.isActive) {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: { isActive: true },
    });
  }

  // 5. Create or update Demo Mobile Employee User (demo@gmail.com / 123456)
  const demoEmail = 'demo@gmail.com';
  let demoUser = await prisma.user.findUnique({
    where: { email: demoEmail },
  });

  if (!demoUser) {
    demoUser = await prisma.user.create({
      data: {
        customerId: customer.id,
        email: demoEmail,
        phone: '+91-9876543210',
        firstName: 'Demo',
        lastName: 'Employee',
        passwordHash: hashedPassword,
        isActive: true,
        isVerified: true,
      },
    });
    console.log(`✅ Created Demo Employee user (${demoEmail} / ${password})`);
  } else {
    demoUser = await prisma.user.update({
      where: { id: demoUser.id },
      data: {
        customerId: customer.id,
        passwordHash: hashedPassword,
        isActive: true,
      },
    });
    console.log(`✅ Refreshed credentials for (${demoEmail})`);
  }

  // 6. Ensure Employee record exists for demoUser
  let employee = await prisma.employee.findUnique({
    where: { userId: demoUser.id },
  });

  if (!employee) {
    employee = await prisma.employee.create({
      data: {
        customerId: customer.id,
        userId: demoUser.id,
        employeeCode: 'EMP-002',
        firstName: 'Demo',
        lastName: 'Employee',
        email: demoEmail,
        phone: '+91-9876543210',
        branch: 'Head Office',
        status: 'ACTIVE',
        mobileLoginEnabled: true,
      },
    });
    console.log(`✅ Created Employee profile EMP-002 for ${demoEmail}`);
  } else {
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        customerId: customer.id,
        status: 'ACTIVE',
        mobileLoginEnabled: true,
      },
    });
  }

  console.log(`✅ Ready: Admin (admin@quikboom.com) & Demo Employee (demo@gmail.com) with password: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
