import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to safely serialize BigInt fields to numbers/strings
   */
  private serializeBigInt(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (Array.isArray(obj)) return obj.map((item) => this.serializeBigInt(item));
    if (typeof obj === 'object' && !(obj instanceof Date)) {
      const copy: any = {};
      for (const key of Object.keys(obj)) {
        copy[key] = this.serializeBigInt(obj[key]);
      }
      return copy;
    }
    return obj;
  }

  /**
   * Get KPI Summary metrics for Customer screen
   */
  async getMetrics() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [totalCustomers, activeCustomers, inactiveCustomers, newCustomers, customersWithDeals] =
      await Promise.all([
        this.prisma.customer.count({ where: { deletedAt: null } }),
        this.prisma.customer.count({ where: { deletedAt: null, isActive: true } }),
        this.prisma.customer.count({ where: { deletedAt: null, isActive: false } }),
        this.prisma.customer.count({
          where: {
            deletedAt: null,
            createdAt: { gte: thirtyDaysAgo },
          },
        }),
        this.prisma.customer.count({
          where: {
            deletedAt: null,
            deals: { some: { isWon: false, isLost: false } },
          },
        }),
      ]);

    return {
      totalCustomers,
      activeCustomers,
      inactiveCustomers,
      newCustomers,
      customersWithOpenDeals: customersWithDeals,
    };
  }

  /**
   * Get all customers with search, advanced filtering, sorting, and pagination
   */
  async findAll(query: {
    search?: string;
    status?: string;
    isActive?: boolean;
    source?: string;
    assignedEmployee?: string;
    company?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    } else if (query.status) {
      if (query.status.toUpperCase() === 'ACTIVE') {
        where.isActive = true;
      } else if (query.status.toUpperCase() === 'INACTIVE') {
        where.isActive = false;
      }
    }

    if (query.source && query.source !== 'ALL') {
      where.source = { equals: query.source, mode: 'insensitive' };
    }

    if (query.assignedEmployee && query.assignedEmployee !== 'ALL') {
      where.assignedEmployee = { contains: query.assignedEmployee, mode: 'insensitive' };
    }

    if (query.company) {
      where.OR = [
        { name: { contains: query.company, mode: 'insensitive' } },
        { companyName: { contains: query.company, mode: 'insensitive' } },
      ];
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { companyName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
        { domain: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const orderBy: any = {};
    const validSortFields = ['name', 'createdAt', 'updatedAt', 'city', 'isActive'];
    const sortField = query.sortBy && validSortFields.includes(query.sortBy) ? query.sortBy : 'createdAt';
    orderBy[sortField] = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          subscriptions: {
            include: { plan: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: {
              users: true,
              leads: true,
              deals: true,
              contacts: true,
              tasks: true,
              tickets: true,
            },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const formatted = items.map((c) => {
      const activeSub = c.subscriptions[0];
      const planName = activeSub?.plan?.name || 'Starter Plan';
      const mrr = activeSub?.plan?.monthlyPrice
        ? `₹${Number(activeSub.plan.monthlyPrice).toLocaleString('en-IN')}`
        : '₹4,999';

      return {
        id: c.id,
        customerId: `CUST-${String(c.id).padStart(4, '0')}`,
        name: c.name,
        companyName: c.companyName || c.name,
        company: c.companyName || c.name,
        domain: c.domain,
        email: c.email || 'N/A',
        phone: c.phone || 'N/A',
        alternatePhone: c.alternatePhone,
        address: c.address,
        city: c.city || 'N/A',
        state: c.state || 'N/A',
        country: c.country || 'India',
        pincode: c.pincode,
        customerType: c.customerType || 'ENTERPRISE',
        industry: c.industry || 'General',
        source: c.source || 'DIRECT',
        assignedEmployee: c.assignedEmployee || 'Unassigned',
        department: c.department || 'General',
        notes: c.notes,
        isActive: c.isActive,
        status: c.isActive ? 'ACTIVE' : 'INACTIVE',
        plan: planName,
        users: c._count.users || 1,
        leads: c._count.leads || 0,
        deals: c._count.deals || 0,
        contacts: c._count.contacts || 0,
        tasks: c._count.tasks || 0,
        storageUsed: Number(c.storageUsed || 0),
        storage: `${(Number(c.storageUsed || 0) / (1024 * 1024)).toFixed(1)} MB`,
        mrr,
        lastActivity: c.updatedAt,
        createdAt: c.createdAt,
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: formatted,
      items: formatted,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
      },
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * Get single customer with complete overview and related CRM entity counts
   */
  async findOne(id: number | string) {
    const numericId = Number(id);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numericId },
      include: {
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
        },
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            designation: true,
            isActive: true,
          },
        },
        _count: {
          select: {
            users: true,
            leads: true,
            deals: true,
            contacts: true,
            tasks: true,
            tickets: true,
            companies: true,
          },
        },
      },
    });

    if (!customer || customer.deletedAt) {
      throw new NotFoundException(`Customer #${id} not found.`);
    }

    const activeSub = customer.subscriptions[0];
    const safeCustomer = this.serializeBigInt(customer);

    return {
      ...safeCustomer,
      customerId: `CUST-${String(customer.id).padStart(4, '0')}`,
      company: customer.companyName || customer.name,
      plan: activeSub?.plan?.name || 'Starter Plan',
      subscriptionStatus: activeSub?.status || 'ACTIVE',
      userCount: customer._count.users,
      leadCount: customer._count.leads,
      dealCount: customer._count.deals,
      contactCount: customer._count.contacts,
      taskCount: customer._count.tasks,
    };
  }

  /**
   * Get Activities & Audit Logs for Customer
   */
  async getCustomerActivities(customerId: number | string) {
    const numericId = Number(customerId);
    const logs = await this.prisma.auditLog.findMany({
      where: { customerId: numericId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    return logs;
  }

  /**
   * Get Tasks for Customer
   */
  async getCustomerTasks(customerId: number | string) {
    const numericId = Number(customerId);
    const tasks = await this.prisma.task.findMany({
      where: { customerId: numericId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        assignedTo: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    return tasks;
  }

  /**
   * Get Visits for Customer
   */
  async getCustomerVisits(customerId: number | string) {
    const numericId = Number(customerId);
    const visits = await this.prisma.visit.findMany({
      where: { customerId: numericId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
      },
    });
    return visits;
  }

  /**
   * Get Deals for Customer
   */
  async getCustomerDeals(customerId: number | string) {
    const numericId = Number(customerId);
    const deals = await this.prisma.deal.findMany({
      where: { customerId: numericId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    });
    return deals;
  }

  /**
   * Create new Customer organization
   */
  async create(dto: CreateCustomerDto) {
    const customer = await this.prisma.customer.create({
      data: {
        name: dto.name,
        companyName: dto.companyName || dto.name,
        domain: dto.domain,
        email: dto.email,
        phone: dto.phone,
        alternatePhone: dto.alternatePhone,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        country: dto.country || 'India',
        pincode: dto.pincode,
        customerType: dto.customerType || 'ENTERPRISE',
        industry: dto.industry,
        source: dto.source || 'DIRECT',
        assignedEmployee: dto.assignedEmployee,
        department: dto.department,
        notes: dto.notes,
        userLimit: dto.userLimit || 15,
        leadLimit: dto.leadLimit || 1000,
      },
    });

    // Automatically provision initial subscription plan if plans exist
    const defaultPlan = await this.prisma.plan.findFirst({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
    });

    if (defaultPlan) {
      await this.prisma.customerSubscription.create({
        data: {
          customerId: customer.id,
          planId: defaultPlan.id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          startDate: new Date(),
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          autoRenew: true,
        },
      });
    }

    return this.serializeBigInt(customer);
  }

  /**
   * Update Customer
   */
  async update(id: number | string, dto: UpdateCustomerDto) {
    const numericId = Number(id);
    await this.findOne(numericId);

    const updated = await this.prisma.customer.update({
      where: { id: numericId },
      data: {
        name: dto.name,
        companyName: dto.companyName,
        email: dto.email,
        phone: dto.phone,
        alternatePhone: dto.alternatePhone,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        country: dto.country,
        pincode: dto.pincode,
        customerType: dto.customerType,
        industry: dto.industry,
        source: dto.source,
        assignedEmployee: dto.assignedEmployee,
        department: dto.department,
        notes: dto.notes,
        isActive: dto.isActive !== undefined ? dto.isActive : undefined,
        userLimit: dto.userLimit,
        leadLimit: dto.leadLimit,
      },
    });

    return this.serializeBigInt(updated);
  }

  /**
   * Soft-delete / deactivate customer
   */
  async remove(id: number | string) {
    const numericId = Number(id);
    await this.findOne(numericId);

    const archived = await this.prisma.customer.update({
      where: { id: numericId },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    return this.serializeBigInt(archived);
  }

  /**
   * Get plan details for customer
   */
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
    const effectiveStorageLimit = activeSub?.customStorageLimit
      ? Number(activeSub.customStorageLimit)
      : (basePlan?.storageLimit ? Number(basePlan.storageLimit) : 10737418240);

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

    await this.prisma.customerSubscription.updateMany({
      where: {
        customerId: numericId,
        status: 'ACTIVE',
      },
      data: {
        status: 'CANCELED',
      },
    });

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
