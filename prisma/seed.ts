import { PrismaClient, RoleType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@quikboom.com';
  const password = '123456';
  const hashedPassword = await bcrypt.hash(password, 10);

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (!existingUser) {
    const customer = await prisma.customer.create({
      data: {
        name: 'QuikBoom Enterprise Workspace',
        email,
        phone: '+1-555-0100',
      },
    });

    const starterPlan = await prisma.plan.upsert({
      where: { code: 'STARTER' },
      update: {},
      create: {
        name: 'Starter Plan',
        code: 'STARTER',
        monthlyPrice: 29.0,
        yearlyPrice: 290.0,
        userLimit: 5,
        leadLimit: 500,
        storageLimit: BigInt(5368709120),
        features: ['LEADS', 'CONTACTS', 'DEALS', 'TASKS'],
      },
    });

    await prisma.customerSubscription.create({
      data: {
        customerId: customer.id,
        planId: starterPlan.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      },
    });

    const adminRole = await prisma.role.create({
      data: {
        customerId: customer.id,
        name: 'Customer Administrator',
        type: RoleType.CUSTOMER_ADMIN,
        description: 'Full administrative access',
      },
    });

    const user = await prisma.user.create({
      data: {
        customerId: customer.id,
        email,
        phone: '+1-555-0100',
        firstName: 'Demo',
        lastName: 'User',
        passwordHash: hashedPassword,
        isVerified: true,
      },
    });

    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: adminRole.id,
      },
    });

    console.log(`✅ Seeded QuikBoom Enterprise Customer & Admin (${email} / ${password})`);
  } else {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { passwordHash: hashedPassword },
    });
    console.log(`✅ Updated password for ${email} to ${password}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
