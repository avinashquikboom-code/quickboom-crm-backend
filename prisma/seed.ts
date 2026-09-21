import { PrismaClient, RoleType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEFAULT_LEAD_STAGES = [
  { key: 'NEW',              name: 'New',              sortOrder: 1,  color: '#0284C7', bgColor: '#E0F2FE', borderColor: '#BAE6FD' },
  { key: 'CONTACTED',       name: 'Contacted',        sortOrder: 2,  color: '#D97706', bgColor: '#FEF3C7', borderColor: '#FDE68A' },
  { key: 'CALL_BACK',       name: 'Call Back',        sortOrder: 3,  color: '#8B5CF6', bgColor: '#F3E8FF', borderColor: '#E9D5FF' },
  { key: 'DETAILS_SENT',    name: 'Details Sent',     sortOrder: 4,  color: '#4F46E5', bgColor: '#EEF2FF', borderColor: '#E0E7FF' },
  { key: 'FOLLOW_UP',       name: 'Follow-Up',        sortOrder: 5,  color: '#06B6D4', bgColor: '#CFFAFE', borderColor: '#A5F3FC' },
  { key: 'VISIT_SCHEDULED', name: 'Visit Scheduled',  sortOrder: 6,  color: '#EA580C', bgColor: '#FFEDD5', borderColor: '#FED7AA' },
  { key: 'VISIT_DONE',      name: 'Visit Done',       sortOrder: 7,  color: '#0891B2', bgColor: '#E0F7FA', borderColor: '#B2EBF2' },
  { key: 'PROPOSAL_SENT',   name: 'Proposal Sent',    sortOrder: 8,  color: '#7C3AED', bgColor: '#EDE9FE', borderColor: '#DDD6FE' },
  { key: 'NEGOTIATION',     name: 'Negotiation',      sortOrder: 9,  color: '#B45309', bgColor: '#FFFBEB', borderColor: '#FDE68A' },
  { key: 'FINAL_CALL',      name: 'Final Call',       sortOrder: 10, color: '#C2410C', bgColor: '#FFF7ED', borderColor: '#FED7AA' },
  { key: 'WON',             name: 'Won',              sortOrder: 11, color: '#15803D', bgColor: '#DCFCE7', borderColor: '#BBF7D0' },
  { key: 'LOST',            name: 'Lost',             sortOrder: 12, color: '#DC2626', bgColor: '#FFF1F2', borderColor: '#FECDD3' },
];

async function seedDefaultLeadStages(customerId: number | null) {
  let created = 0;
  for (const stage of DEFAULT_LEAD_STAGES) {
    try {
      await prisma.leadStage.upsert({
        where: {
          customerId_key: { customerId: customerId as any, key: stage.key },
        },
        update: {}, // Never overwrite existing data
        create: {
          customerId,
          name: stage.name,
          key: stage.key,
          sortOrder: stage.sortOrder,
          color: stage.color,
          bgColor: stage.bgColor,
          borderColor: stage.borderColor,
          isActive: true,
          isSystem: true,
        },
      });
      created++;
    } catch (err: any) {
      // Skip if already exists with different unique key structure
      if (!err.message?.includes('Unique constraint')) throw err;
    }
  }
  if (created > 0) {
    console.log(`✅ Seeded ${created} default lead stages for customer ${customerId ?? 'global'}`);
  } else {
    console.log(`✓  Lead stages already exist for customer ${customerId ?? 'global'} — skipped`);
  }
}

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

  // 4.1 Seed default lead stages for the default customer (idempotent)
  await seedDefaultLeadStages(customer.id);

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

  // 5.1 Ensure default office location (BranchGeofence) exists for the customer
  let headOffice = await prisma.branchGeofence.findFirst({
    where: { customerId: customer.id, isActive: true },
  });

  if (!headOffice) {
    headOffice = await prisma.branchGeofence.create({
      data: {
        customerId: customer.id,
        name: 'Head Office',
        city: 'Mumbai',
        latitude: 19.0760,
        longitude: 72.8777,
        radiusMeters: 500.0,
        isActive: true,
      },
    });
    console.log(`✅ Created Head Office geofence for customer ${customer.id}`);
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
        branch: headOffice.name,
        officeId: headOffice.id,
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
        officeId: headOffice.id,
        branch: headOffice.name,
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

  // 8. Seed QUIKBOOM CRM Email Templates (11 Telecaller Stage Templates)
  const QUIKBOOM_TEMPLATES = [
    {
      key: 'QUIKBOOM_NEW_LEAD',
      name: 'New Lead – QUIKBOOM',
      category: 'CRM',
      subject: 'Thank You for Connecting with QUIKBOOM',
      description: 'Sent when an inquiry or new lead connects with QUIKBOOM',
      supportedVariables: ['leadTitle', 'userName', 'email'],
      body: `Dear {{leadTitle}},

Thank you for your interest in QUIKBOOM Digital Marketing Agency.

Our team has received your inquiry and will be connecting with you shortly to understand your business requirements.

We look forward to speaking with you and exploring how we can help your business grow.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency

{{email}}`,
    },
    {
      key: 'QUIKBOOM_CONTACTED',
      name: 'Customer Contacted – QUIKBOOM',
      category: 'CRM',
      subject: 'Great Speaking With You – QUIKBOOM',
      description: 'Sent after telecaller contacts prospective lead',
      supportedVariables: ['leadTitle', 'userName'],
      body: `Dear {{leadTitle}},

Thank you for taking the time to speak with our team.

We appreciate the opportunity to understand your business and digital marketing requirements.

We will be happy to assist you with the right solutions for your business.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
    },
    {
      key: 'QUIKBOOM_QUALIFIED',
      name: 'Lead Qualified – QUIKBOOM',
      category: 'CRM',
      subject: 'Your Requirements Have Been Qualified – QUIKBOOM',
      description: 'Sent automatically when a prospective lead is qualified by the CRM team',
      supportedVariables: ['leadTitle', 'leadName', 'userName', 'email', 'companyName', 'assignedUser', 'assignedEmployeeName', 'assignedEmployeeEmail'],
      body: `Dear {{leadTitle}},

We are pleased to inform you that your requirements with QUIKBOOM Digital Marketing Agency have been qualified!

Our team is now preparing tailored solutions to help your business achieve maximum growth. We will be in touch with a customized proposal shortly.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency

{{email}}`,
    },
    {
      key: 'QUIKBOOM_DETAILS_SENT',
      name: 'Company Details Sent – QUIKBOOM',
      category: 'CRM',
      subject: 'QUIKBOOM – Company Details & Services',
      description: 'Sent with agency details and services overview',
      supportedVariables: ['leadTitle', 'userName', 'email'],
      body: `Dear {{leadTitle}},

As discussed during our call, we are sharing the details of QUIKBOOM Digital Marketing Agency for your reference.

You can explore our company, services and work through our website.

Visit QUIKBOOM Website

We look forward to discussing your requirements further.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency

{{email}}`,
    },
    {
      key: 'QUIKBOOM_FOLLOW_UP',
      name: 'Customer Follow-up – QUIKBOOM',
      category: 'CRM',
      subject: 'Following Up on Our Discussion – QUIKBOOM',
      description: 'Sent during regular telecaller follow-up',
      supportedVariables: ['leadTitle', 'userName'],
      body: `Dear {{leadTitle}},

We wanted to follow up regarding our recent conversation about your digital marketing requirements.

Please let us know if you have any questions or if you would like to discuss the next steps.

Our team will be happy to assist you.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
    },
    {
      key: 'QUIKBOOM_VISIT_SCHEDULED',
      name: 'Visit Scheduled – QUIKBOOM',
      category: 'CRM',
      subject: 'Your Meeting with QUIKBOOM is Scheduled',
      description: 'Sent when an in-person or virtual visit is confirmed',
      supportedVariables: ['leadTitle', 'startDate', 'startTime', 'userName'],
      body: `Dear {{leadTitle}},

This is to confirm that your visit/meeting with QUIKBOOM Digital Marketing Agency has been scheduled.

We look forward to meeting you and discussing your business requirements in detail.

Meeting Details:

Date: {{startDate}}

Time: {{startTime}}

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
    },
    {
      key: 'QUIKBOOM_VISIT_DONE',
      name: 'Visit Completed – QUIKBOOM',
      category: 'CRM',
      subject: 'Thank You for Visiting QUIKBOOM',
      description: 'Sent after concluding a client visit or meeting',
      supportedVariables: ['leadTitle', 'userName'],
      body: `Dear {{leadTitle}},

Thank you for visiting QUIKBOOM Digital Marketing Agency.

It was a pleasure meeting with you and discussing your business requirements.

We appreciate your time and look forward to taking our conversation ahead.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
    },
    {
      key: 'QUIKBOOM_PROPOSAL_SENT',
      name: 'Proposal Sent – QUIKBOOM',
      category: 'CRM',
      subject: 'Your Digital Marketing Proposal from QUIKBOOM',
      description: 'Sent when digital marketing proposal is sent to client',
      supportedVariables: ['leadTitle', 'userName'],
      body: `Dear {{leadTitle}},

As discussed, we have shared the proposal for your business requirements.

Please review the proposal and feel free to contact us if you have any questions or require any clarification.

We look forward to working with you.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
    },
    {
      key: 'QUIKBOOM_NEGOTIATION',
      name: 'Proposal Discussion – QUIKBOOM',
      category: 'CRM',
      subject: "Let's Discuss Your Proposal – QUIKBOOM",
      description: 'Sent during commercials and proposal negotiation',
      supportedVariables: ['leadTitle', 'userName'],
      body: `Dear {{leadTitle}},

Thank you for reviewing our proposal.

We would be happy to discuss the proposal, requirements and available options with you.

Please feel free to share your feedback so that we can take the discussion forward.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
    },
    {
      key: 'QUIKBOOM_FINAL_CALL',
      name: 'Final Discussion – QUIKBOOM',
      category: 'CRM',
      subject: 'Final Discussion Regarding Your Digital Marketing Requirements',
      description: 'Sent for final discussion before deal closure',
      supportedVariables: ['leadTitle', 'userName'],
      body: `Dear {{leadTitle}},

We are reaching out for a final discussion regarding the digital marketing solutions discussed with you.

Please let us know if you would like to proceed or if there are any remaining questions we can help you with.

We look forward to hearing from you.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
    },
    {
      key: 'QUIKBOOM_WON',
      name: 'Customer Onboarding – QUIKBOOM',
      category: 'CRM',
      subject: "Welcome to QUIKBOOM – Let's Grow Together! 🎉",
      description: 'Sent when a deal is closed/won and onboarding starts',
      supportedVariables: ['leadTitle', 'userName', 'email'],
      body: `Dear {{leadTitle}},

Welcome to QUIKBOOM Digital Marketing Agency! 🎉

Thank you for choosing QUIKBOOM as your digital marketing partner.

We are excited to work with you and help your business achieve its digital marketing goals.

Our team will connect with you regarding the next steps and onboarding process.

Welcome to the QUIKBOOM family!

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency

{{email}}`,
    },
    {
      key: 'QUIKBOOM_LOST',
      name: 'Lead Closed – QUIKBOOM',
      category: 'CRM',
      subject: 'Thank You for Considering QUIKBOOM',
      description: 'Sent when a lead deal is closed/lost',
      supportedVariables: ['leadTitle', 'userName'],
      body: `Dear {{leadTitle}},

Thank you for taking the time to speak with QUIKBOOM Digital Marketing Agency and considering our services.

We completely understand that the timing may not be right at this moment.

If your requirements change in the future, we would be happy to connect with you again.

We wish you and your business continued success.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
    },
  ];

  for (const t of QUIKBOOM_TEMPLATES) {
    const existing = await prisma.emailTemplate.findFirst({
      where: {
        key: t.key,
        customerId: null,
        deletedAt: null,
      },
    });

    if (!existing) {
      await prisma.emailTemplate.create({
        data: {
          customerId: null,
          key: t.key,
          name: t.name,
          category: t.category,
          subject: t.subject,
          description: t.description,
          supportedVariables: t.supportedVariables,
          body: t.body,
          isSystem: true,
          isActive: true,
        },
      });
      console.log(`✅ Created email template: [${t.key}] ${t.name}`);
    } else {
      await prisma.emailTemplate.update({
        where: { id: existing.id },
        data: {
          name: t.name,
          category: t.category,
          subject: t.subject,
          description: t.description,
          supportedVariables: t.supportedVariables,
          body: t.body,
          isSystem: true,
          isActive: true,
        },
      });
      console.log(`✅ Refreshed email template: [${t.key}] ${t.name}`);
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
