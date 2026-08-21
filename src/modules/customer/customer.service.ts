import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(search?: string, isActive?: boolean, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const where: any = {
      deletedAt: null,
    };

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          subscriptions: {
            include: {
              plan: true,
            },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: {
              users: true,
              leads: true,
            },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const formatted = items.map((c) => {
      const activeSub = c.subscriptions[0];
      const planName = activeSub?.plan?.name || 'Starter Plan';
      const mrr = activeSub?.plan?.monthlyPrice ? `₹${Number(activeSub.plan.monthlyPrice).toLocaleString('en-IN')}` : '₹4,999';

      return {
        id: c.id,
        name: c.name,
        domain: c.domain,
        email: c.email,
        phone: c.phone,
        city: c.city,
        state: c.state,
        isActive: c.isActive,
        status: c.isActive ? 'active' : 'inactive',
        plan: planName,
        users: c._count.users || 1,
        leads: c._count.leads || 0,
        storage: `${(Number(c.storageUsed) / (1024 * 1024)).toFixed(1)} MB`,
        mrr,
        createdAt: c.createdAt,
      };
    });

    return {
      items: formatted,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number | string) {
    const numericId = Number(id);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numericId },
      include: {
        subscriptions: {
          include: {
            plan: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        _count: {
          select: {
            users: true,
            leads: true,
            deals: true,
            contacts: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    const activeSub = customer.subscriptions[0];

    return {
      ...customer,
      plan: activeSub?.plan?.name || 'Starter Plan',
      subscriptionStatus: activeSub?.status || 'ACTIVE',
      userCount: customer._count.users,
      leadCount: customer._count.leads,
      dealCount: customer._count.deals,
      contactCount: customer._count.contacts,
    };
  }

  async create(dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        name: dto.name,
        domain: dto.domain,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        userLimit: dto.userLimit || 15,
        leadLimit: dto.leadLimit || 1000,
      },
    });
  }

  async update(id: number | string, dto: UpdateCustomerDto) {
    const numericId = Number(id);
    await this.findOne(numericId);
    return this.prisma.customer.update({
      where: { id: numericId },
      data: dto,
    });
  }

  async remove(id: number | string) {
    const numericId = Number(id);
    await this.findOne(numericId);
    return this.prisma.customer.update({
      where: { id: numericId },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
  }

  async getCustomerPlan(id: number | string) {
    const numericId = Number(id);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numericId },
      include: {
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    const activeSub = customer.subscriptions[0];
    const availablePlans = await this.prisma.plan.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { monthlyPrice: 'asc' },
    });

    const basePlan = activeSub?.plan || availablePlans[0] || null;

    const basePrice = basePlan ? Number(basePlan.monthlyPrice) : 0;
    const customPrice = activeSub?.customPrice !== null && activeSub?.customPrice !== undefined
      ? Number(activeSub.customPrice)
      : null;

    const effectiveFeatures = activeSub?.customFeatures || basePlan?.features || [
      'Customer Management',
      'Calendar',
      'Works',
      'Tasks',
      'Reports',
      'Notifications',
    ];

    const effectiveUserLimit = activeSub?.customUserLimit || customer.userLimit || basePlan?.userLimit || 10;
    const effectiveLeadLimit = activeSub?.customLeadLimit || customer.leadLimit || basePlan?.leadLimit || 500;
    const effectiveStorageLimit = activeSub?.customStorageLimit ? Number(activeSub.customStorageLimit) : (basePlan?.storageLimit ? Number(basePlan.storageLimit) : 10737418240);

    return {
      customerId: customer.id,
      customerName: customer.name,
      subscriptionId: activeSub?.id || null,
      planId: basePlan?.id || null,
      planName: basePlan?.name || 'No Plan Assigned',
      status: activeSub?.status || 'ACTIVE',
      startDate: activeSub?.startDate || customer.createdAt,
      endDate: activeSub?.endDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      basePrice,
      customPrice: customPrice !== null ? customPrice : basePrice,
      isCustomized: customPrice !== null || Boolean(activeSub?.customFeatures) || Boolean(activeSub?.customUserLimit),
      features: effectiveFeatures,
      userLimit: effectiveUserLimit,
      leadLimit: effectiveLeadLimit,
      storageLimit: effectiveStorageLimit,
      availablePlans: availablePlans.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        monthlyPrice: Number(p.monthlyPrice),
        yearlyPrice: Number(p.yearlyPrice),
        userLimit: p.userLimit,
        leadLimit: p.leadLimit,
        features: p.features,
      })),
    };
  }

  async getCustomerPlanHistory(id: number | string) {
    const numericId = Number(id);
    const subscriptions = await this.prisma.customerSubscription.findMany({
      where: { customerId: numericId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    return subscriptions.map((s) => ({
      id: s.id,
      planId: s.planId,
      planName: s.plan.name,
      status: s.status,
      billingCycle: s.billingCycle,
      startDate: s.startDate,
      endDate: s.endDate,
      basePrice: Number(s.plan.monthlyPrice),
      effectivePrice: s.customPrice !== null ? Number(s.customPrice) : Number(s.plan.monthlyPrice),
      customPrice: s.customPrice !== null ? Number(s.customPrice) : null,
      isCustomized: s.customPrice !== null || Boolean(s.customFeatures) || Boolean(s.customUserLimit),
      userLimit: s.customUserLimit || s.plan.userLimit,
      createdAt: s.createdAt,
    }));
  }

  async customizeCustomerPlan(id: number | string, dto: any) {
    const numericId = Number(id);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numericId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    const planId = Number(dto.planId);
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);

    if (endDate < startDate) {
      throw new Error('End date must be greater than or equal to start date');
    }

    const customPrice = dto.customPrice !== undefined && dto.customPrice !== null && dto.customPrice !== ''
      ? Number(dto.customPrice)
      : null;

    const customUserLimit = dto.userLimit !== undefined && dto.userLimit !== null
      ? Number(dto.userLimit)
      : plan.userLimit;

    const customLeadLimit = dto.leadLimit !== undefined && dto.leadLimit !== null
      ? Number(dto.leadLimit)
      : plan.leadLimit;

    const customFeatures = Array.isArray(dto.features) ? dto.features : plan.features;
    const status = dto.status || 'ACTIVE';

    // Mark previous active subscriptions as EXPIRED/CANCELED to preserve historical records
    await this.prisma.customerSubscription.updateMany({
      where: {
        customerId: numericId,
        status: 'ACTIVE',
      },
      data: {
        status: 'CANCELED',
      },
    });

    // Create the new customized subscription record
    const newSubscription = await this.prisma.customerSubscription.create({
      data: {
        customerId: numericId,
        planId: plan.id,
        status: status as any,
        billingCycle: 'MONTHLY',
        startDate,
        endDate,
        customPrice,
        customFeatures,
        customUserLimit,
        customLeadLimit,
        autoRenew: true,
      },
      include: {
        plan: true,
      },
    });

    // Update customer entity user and lead limits
    await this.prisma.customer.update({
      where: { id: numericId },
      data: {
        userLimit: customUserLimit,
        leadLimit: customLeadLimit,
      },
    });

    return {
      success: true,
      message: `Customer ${customer.name} plan updated to ${plan.name}`,
      subscription: {
        id: newSubscription.id,
        customerId: newSubscription.customerId,
        planId: newSubscription.planId,
        planName: newSubscription.plan.name,
        status: newSubscription.status,
        startDate: newSubscription.startDate,
        endDate: newSubscription.endDate,
        basePrice: Number(newSubscription.plan.monthlyPrice),
        customPrice: newSubscription.customPrice !== null ? Number(newSubscription.customPrice) : null,
        features: newSubscription.customFeatures,
        userLimit: newSubscription.customUserLimit,
        leadLimit: newSubscription.customLeadLimit,
      },
    };
  }
}
