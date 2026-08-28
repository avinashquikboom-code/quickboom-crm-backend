import { PrismaClient, RoleType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@quickboom.com';
  const legacyEmail = 'admin@quikboom.com';
  const password = '123456';
  const hashedPassword = await bcrypt.hash(password, 10);

  // 1. Ensure standard roles exist (SUPER_ADMIN, CUSTOMER, EMPLOYEE, COMPANY_ADMIN)
  let superAdminRole = await prisma.role.findFirst({
    where: {
      OR: [
        { id: 2 },
        { type: RoleType.SUPER_ADMIN },
        { name: 'SUPER_ADMIN' },
        { name: 'Super Administrator' },
      ],
    },
  });

  if (!superAdminRole) {
    superAdminRole = await prisma.role.create({
      data: {
        name: 'SUPER_ADMIN',
        type: RoleType.SUPER_ADMIN,
        description: 'Full administrative platform access',
      },
    });
  } else {
    superAdminRole = await prisma.role.update({
      where: { id: superAdminRole.id },
      data: {
        name: 'SUPER_ADMIN',
        type: RoleType.SUPER_ADMIN,
      },
    });
  }

  // Ensure Customer, Employee, Company Admin roles exist
  let customerRole = await prisma.role.findFirst({
    where: { OR: [{ id: 3 }, { name: 'CUSTOMER' }] },
  });
  if (!customerRole) {
    await prisma.role.create({
      data: { name: 'CUSTOMER', type: RoleType.CUSTOM, description: 'Customer role' },
    });
  }

  let employeeRole = await prisma.role.findFirst({
    where: { OR: [{ id: 4 }, { name: 'EMPLOYEE' }] },
  });
  if (!employeeRole) {
    await prisma.role.create({
      data: { name: 'EMPLOYEE', type: RoleType.CUSTOM, description: 'Employee role' },
    });
  }

  let companyAdminRole = await prisma.role.findFirst({
    where: { OR: [{ id: 5 }, { type: RoleType.CUSTOMER_ADMIN }, { name: 'COMPANY_ADMIN' }] },
  });
  if (!companyAdminRole) {
    await prisma.role.create({
      data: { name: 'COMPANY_ADMIN', type: RoleType.CUSTOMER_ADMIN, description: 'Company Admin role' },
    });
  }

  // 2. Find or Create User ID = 1 (Do not create another Super Admin if ID 1 exists)
  let user = await prisma.user.findUnique({
    where: { id: 1 },
  });

  if (!user) {
    user = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { email: legacyEmail }],
      },
    });
  }

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        phone: '+1-555-0100',
        firstName: 'Super',
        lastName: 'Admin',
        passwordHash: hashedPassword,
        isActive: true,
        isVerified: true,
      },
    });
    console.log(`✅ Created Super Admin user (${user.email} / ${password}) with ID: ${user.id}`);
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        email,
        firstName: 'Super',
        lastName: 'Admin',
        passwordHash: hashedPassword,
        isActive: true,
        isVerified: true,
        deletedAt: null,
      },
    });
    console.log(`✅ Updated Super Admin user ID: ${user.id} (${user.email})`);
  }

  // 3. Ensure UserRole: userId = user.id, roleId = superAdminRole.id
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
  let customer = await prisma.customer.findFirst();

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

  // 7. Seed / Upsert standard subscription packages
  const plans = [
    {
      name: 'Basic Package',
      code: 'BASIC',
      description: 'Starter Plan for emerging businesses',
      monthlyPrice: 9999,
      yearlyPrice: 95990,
      userLimit: 5,
      leadLimit: 500,
      storageLimit: BigInt(5368709120),
      features: [
        '4 Reels',
        '3 Creative Posts',
        '1 Influencer Promotion',
        '3 Stories',
        'Social Media Account Management',
        'Content Writing & Captions',
        'Trending Hashtags',
        'Meta Ads Campaign Setup & Management',
        'Google Ads Campaign Setup & Management',
        'Monthly Performance Report',
        'Ads will run only during the content execution period.',
        'Meta & Google Ads Budget will be paid by the client.',
      ],
    },
    {
      name: 'Standard Package',
      code: 'STANDARD',
      description: 'Growth Plan for expanding companies',
      monthlyPrice: 14999,
      yearlyPrice: 143990,
      userLimit: 25,
      leadLimit: 5000,
      storageLimit: BigInt(26843545600),
      features: [
        '6 Reels',
        '4 Creative Posts',
        '2 Influencer Promotions',
        '5 Stories',
        'Social Media Account Management',
        'Trending Hashtags',
        'Meta Ads Campaign Setup & Management',
        'Google Ads Campaign Setup & Management',
        'Monthly Performance Report',
        'Ads will run only during the content execution period.',
        'Meta & Google Ads Budget will be paid by the client.',
      ],
    },
    {
      name: 'Premium Package',
      code: 'PREMIUM',
      description: 'Scale Plan for enterprise-level growth',
      monthlyPrice: 25999,
      yearlyPrice: 249590,
      userLimit: 100,
      leadLimit: 50000,
      storageLimit: BigInt(107374182400),
      features: [
        '2 Product Reels',
        '8 Influencer Reels (Total 10 Reels)',
        '8 Creative Posts',
        '30 Stories',
        'Complete Social Media Management',
        'Premium Content Strategy & Caption Writing',
        'Advanced Hashtag Research',
        'Meta Ads Campaign Setup & Management',
        'Google Ads Campaign Setup & Management',
        'Detailed Monthly Analytics Report',
        'Priority Graphic Designing',
        'Ads will run throughout the campaign/content execution period.',
        'Meta & Google Ads Budget will be paid by the client.',
      ],
    },
  ];

  for (const p of plans) {
    const existing = await prisma.plan.findUnique({
      where: { code: p.code },
    });
    if (!existing) {
      await prisma.plan.create({ data: p });
      console.log(`✅ Created plan: ${p.name}`);
    } else {
      await prisma.plan.update({
        where: { id: existing.id },
        data: {
          name: p.name,
          monthlyPrice: p.monthlyPrice,
          yearlyPrice: p.yearlyPrice,
          description: p.description,
          features: p.features,
          isActive: true,
        },
      });
      console.log(`✅ Refreshed plan: ${p.name}`);
    }
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
