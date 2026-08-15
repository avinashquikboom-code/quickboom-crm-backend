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
    const tenant = await prisma.tenant.create({
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

    await prisma.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: starterPlan.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      },
    });

    const adminRole = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: 'Tenant Administrator',
        type: RoleType.TENANT_ADMIN,
        description: 'Full administrative access',
      },
    });

    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email,
        phone: '+1-555-0100',
        firstName: 'Avinash',
        lastName: 'Admin',
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

    console.log(`✅ Seeded QuikBoom Enterprise Tenant & Admin (${email} / ${password})`);
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
