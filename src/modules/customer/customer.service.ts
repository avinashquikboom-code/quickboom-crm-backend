import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  UpdateCustomerProfileDto,
} from './dto/customer.dto';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { calculatePlanExpiry, calculateSubscriptionStartDate } from '../../common/utils/subscription-date.util';

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
    private readonly qbIdGenerator: QBIdGenerator,
    private readonly workService?: WorkService,
  ) {}

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
   * Get Customer Resource Consumption analytics, breakdown, and KPI metrics
   */
  async getResourceConsumption(query: {
    search?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    if (query.status && query.status !== 'ALL' && query.status.trim() !== '') {
      if (query.status.toUpperCase() === 'ACTIVE') {
        where.isActive = true;
      } else if (query.status.toUpperCase() === 'INACTIVE') {
        where.isActive = false;
      }
    }

    if (query.search && query.search.trim() !== '') {
      const searchTerm = query.search.trim();
      where.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { companyName: { contains: searchTerm, mode: 'insensitive' } },
        { domain: { contains: searchTerm, mode: 'insensitive' } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) {
        where.createdAt.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        const to = new Date(query.dateTo);
        to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }

    let orderBy: any = { createdAt: 'desc' };
    if (query.sortBy) {
      const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
      if (['name', 'createdAt', 'storageUsed'].includes(query.sortBy)) {
        orderBy = { [query.sortBy]: direction };
      }
    }

    const [total, customers, allCustomersStats] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          subscriptions: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { plan: true },
          },
          _count: {
            select: {
              users: { where: { deletedAt: null } },
              leads: { where: { deletedAt: null } },
              works: true,
              dataCapturePlaces: { where: { deletedAt: null } },
            },
          },
        },
      }),
      this.prisma.customer.findMany({
        where: { deletedAt: null },
        include: {
          subscriptions: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { plan: true },
          },
          _count: {
            select: {
              users: { where: { deletedAt: null } },
              leads: { where: { deletedAt: null } },
              works: true,
              dataCapturePlaces: { where: { deletedAt: null } },
            },
          },
        },
      }),
    ]);

    // Format Storage Helper
    const formatStorage = (bytes: number | bigint): string => {
      const numBytes = Number(bytes || 0);
      if (numBytes >= 1024 * 1024 * 1024) {
        return (numBytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
      }
      return (numBytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    // Calculate Global Aggregated KPIs
    let totalAllocatedSeats = 0;
    let totalMaxSeats = 0;
    let totalLeads = 0;
    let totalStorageBytes = 0;
    let activeCustomersCount = 0;

    for (const c of allCustomersStats as any[]) {
      if (c.isActive) activeCustomersCount++;
      const userCount = c._count?.users || 0;
      const leadCount = c._count?.leads || 0;
      const sub = c.subscriptions?.[0];
      const maxUsers = sub?.customUserLimit ?? sub?.plan?.userLimit ?? c.userLimit ?? 5;
      const storageBytes = Number(c.storageUsed || 0);

      totalAllocatedSeats += userCount;
      totalMaxSeats += maxUsers;
      totalLeads += leadCount;
      totalStorageBytes += storageBytes;
    }

    const overallSeatUtilizationPct =
      totalMaxSeats > 0 ? ((totalAllocatedSeats / totalMaxSeats) * 100).toFixed(1) + '%' : '0.0%';

    // Map Items for current page
    const items = (customers as any[]).map((c) => {
      const sub = c.subscriptions?.[0];
      const users = c._count?.users || 0;
      const maxUsers = sub?.customUserLimit ?? sub?.plan?.userLimit ?? c.userLimit ?? 50;
      const leads = c._count?.leads || 0;
      const maxLeads = sub?.customLeadLimit ?? sub?.plan?.leadLimit ?? c.leadLimit ?? 500;
      const storageBytes = Number(c.storageUsed || 0);
      const maxStorageBytes = Number(sub?.customStorageLimit ?? sub?.plan?.storageLimit ?? c.storageLimit ?? 5368709120);
      const seatPct = maxUsers > 0 ? Math.min(100, Math.round((users / maxUsers) * 100)) : 0;
      const leadPct = maxLeads > 0 ? Math.min(100, Math.round((leads / maxLeads) * 100)) : 0;

      return {
        id: c.id,
        name: c.name || c.companyName || `Customer #${c.id}`,
        companyName: c.companyName || c.name || '',
        domain: c.domain || (c.email ? c.email.split('@')[1] : '') || 'N/A',
        email: c.email || '',
        phone: c.phone || '',
        isActive: c.isActive,
        status: c.isActive ? 'ACTIVE' : 'INACTIVE',
        planName: sub ? (sub.customFeatures ? 'Custom Plan' : sub.plan?.name || 'Standard Plan') : 'No Active Plan',
        users,
        maxUsers,
        seatUtilization: seatPct,
        leads,
        maxLeads,
        leadUtilization: leadPct,
        storageBytes,
        maxStorageBytes,
        storage: formatStorage(storageBytes),
        maxStorage: formatStorage(maxStorageBytes),
        worksCount: c._count?.works || 0,
        dataCapturePlacesCount: c._count?.dataCapturePlaces || 0,
        createdAt: c.createdAt,
      };
    });

    return {
      success: true,
      summary: {
        totalAllocatedSeats,
        totalMaxSeats,
        overallSeatUtilization: overallSeatUtilizationPct,
        totalLeads,
        totalStorageBytes,
        totalStorage: formatStorage(totalStorageBytes),
        totalCustomers: allCustomersStats.length,
        activeCustomers: activeCustomersCount,
      },
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
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
            deals: { some: { deletedAt: null, isWon: false, isLost: false } },
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
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    } else if (query.status && query.status !== 'ALL' && query.status.trim() !== '') {
      if (query.status.toUpperCase() === 'ACTIVE') {
        where.isActive = true;
      } else if (query.status.toUpperCase() === 'INACTIVE') {
        where.isActive = false;
      }
    }

    if (query.source && query.source !== 'ALL' && query.source.trim() !== '') {
      where.source = { equals: query.source.trim(), mode: 'insensitive' };
    }

    if (query.assignedEmployee && query.assignedEmployee !== 'ALL' && query.assignedEmployee.trim() !== '') {
      where.assignedEmployee = { contains: query.assignedEmployee.trim(), mode: 'insensitive' };
    }

    if (query.company && query.company.trim()) {
      const c = query.company.trim();
      where.OR = [
        { name: { contains: c, mode: 'insensitive' } },
        { companyName: { contains: c, mode: 'insensitive' } },
      ];
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { companyName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { city: { contains: s, mode: 'insensitive' } },
        { domain: { contains: s, mode: 'insensitive' } },
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
            where: { deletedAt: null },
            include: { plan: true },
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

    const now = new Date();
    const formatted = items.map((c) => {
      // Find latest valid active subscription, otherwise latest created
      const activeSub =
        c.subscriptions.find(
          (s) =>
            s.status === 'ACTIVE' &&
            (!s.endDate || new Date(s.endDate) >= now),
        ) || c.subscriptions[0];

      const isSubActive =
        activeSub &&
        activeSub.status === 'ACTIVE' &&
        (!activeSub.endDate || new Date(activeSub.endDate) >= now);

      const planName = activeSub?.plan?.name || 'No Active Plan';
      const planCode = activeSub?.plan?.code || 'NONE';
      const billingCycle = activeSub?.billingCycle || 'MONTHLY';
      const subStatus = activeSub
        ? isSubActive
          ? 'ACTIVE'
          : activeSub.status === 'ACTIVE'
          ? 'EXPIRED'
          : activeSub.status
        : 'NO_PLAN';

      const basePrice = activeSub?.plan
        ? billingCycle === 'YEARLY'
          ? Number(activeSub.plan.yearlyPrice)
          : Number(activeSub.plan.monthlyPrice)
        : 0;

      const gst = Math.round(basePrice * 0.18);
      const totalAmount = basePrice + gst;
      const mrr = activeSub?.plan?.monthlyPrice
        ? `₹${Number(activeSub.plan.monthlyPrice).toLocaleString('en-IN')}`
        : '₹0';

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
        planCode,
        billingCycle,
        subscriptionStatus: subStatus,
        subscriptionStartDate: activeSub?.startDate || null,
        subscriptionEndDate: activeSub?.endDate || null,
        subscriptionAmount: totalAmount,
        baseAmount: basePrice,
        gstAmount: gst,
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

    this.logger.log(
      `[ADMIN_GET_CUSTOMERS] Total count: ${total}, Returned customer IDs: [${items.map((c) => c.id).join(', ')}]`,
    );

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
   * Helper to validate and convert raw customer ID to positive integer
   */
  private parseCustomerId(id: number | string): number {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new BadRequestException('Invalid customer ID');
    }
    return numericId;
  }

  /**
   * Get single customer with complete overview and related CRM entity counts
   */
  async findOne(id: number | string) {
    const numericId = this.parseCustomerId(id);
    this.logger.log(
      `[ADMIN_GET_CUSTOMER_DETAILS] Fetching details for customerId=${numericId}`,
    );
    const customer = await this.prisma.customer.findUnique({
      where: { id: numericId },
      include: {
        subscriptions: {
          where: { deletedAt: null },
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

    const now = new Date();
    const activeSub =
      customer.subscriptions.find(
        (s) =>
          s.status === 'ACTIVE' &&
          (!s.endDate || new Date(s.endDate) >= now),
      ) || customer.subscriptions[0];

    const isSubActive =
      activeSub &&
      activeSub.status === 'ACTIVE' &&
      (!activeSub.endDate || new Date(activeSub.endDate) >= now);

    const safeCustomer = this.serializeBigInt(customer);

    const planName = activeSub?.plan?.name || 'No Active Plan';

    const subStatus = activeSub
      ? isSubActive
        ? 'ACTIVE'
        : activeSub.status === 'ACTIVE'
        ? 'EXPIRED'
        : activeSub.status
      : 'NO_PLAN';

    return {
      ...safeCustomer,
      customerId: `CUST-${String(customer.id).padStart(4, '0')}`,
      company: customer.companyName || customer.name,
      plan: planName,
      planCode: activeSub?.plan?.code || 'NONE',
      billingCycle: activeSub?.billingCycle || 'MONTHLY',
      subscriptionStatus: subStatus,
      subscriptionStartDate: activeSub?.startDate || null,
      subscriptionEndDate: activeSub?.endDate || null,
      currentSubscription: activeSub
        ? {
            id: activeSub.id,
            planId: activeSub.planId,
            planName: activeSub.plan.name,
            planCode: activeSub.plan.code,
            billingCycle: activeSub.billingCycle,
            status: subStatus,
            startDate: activeSub.startDate,
            endDate: activeSub.endDate,
            basePrice:
              activeSub.billingCycle === 'YEARLY'
                ? Number(activeSub.plan.yearlyPrice)
                : Number(activeSub.plan.monthlyPrice),
          }
        : null,
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
    const numericId = this.parseCustomerId(customerId);
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
    const numericId = this.parseCustomerId(customerId);
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
    const numericId = this.parseCustomerId(customerId);
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
    const numericId = this.parseCustomerId(customerId);
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
    const numericId = this.parseCustomerId(id);
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
    const numericId = this.parseCustomerId(id);
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
    const numericId = this.parseCustomerId(id);
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
    const numericId = this.parseCustomerId(id);
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
    const numericId = this.parseCustomerId(id);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numericId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    const planId = Number(dto.planId);
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null, isActive: true },
    });

    if (!plan) {
      throw new BadRequestException('This subscription plan is no longer available.');
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : calculateSubscriptionStartDate(new Date());
    const durationMonths = dto.duration
      ? Number(dto.duration)
      : dto.endDate
      ? Math.max(1, Math.round((new Date(dto.endDate).getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)))
      : (dto.billingCycle === 'YEARLY' ? 12 : 1);

    const endDate = dto.endDate ? new Date(dto.endDate) : calculatePlanExpiry(startDate, durationMonths);

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

    // Handle existing active subscriptions and their future unstarted schedules
    const existingActiveSubs = await this.prisma.customerSubscription.findMany({
      where: {
        customerId: numericId,
        status: 'ACTIVE',
      },
    });

    for (const sub of existingActiveSubs) {
      await this.scheduleService.handleSubscriptionCancellation(sub.id);
    }

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
        billingCycle: durationMonths >= 12 ? 'YEARLY' : 'MONTHLY',
        duration: durationMonths,
        durationUnit: 'MONTH',
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

    // Auto-generate monthly schedule records and work deliverable schedules strictly for this plan
    let generatedSchedules = [];
    try {
      if (this.scheduleService) {
        const scheduleResult = await this.scheduleService.generateSchedulesForSubscription(newSubscription.id);
        generatedSchedules = scheduleResult?.schedules || [];
      }
      if (this.workService) {
        await this.workService.generatePlanSchedules(numericId, newSubscription.id);
      }
    } catch (err) {
      // Non-blocking fallback
    }

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
        purchaseDate: newSubscription.startDate,
        expiryDate: newSubscription.endDate,
        endDate: newSubscription.endDate,
        duration: newSubscription.duration,
        durationUnit: newSubscription.durationUnit,
        basePrice: Number(newSubscription.plan.monthlyPrice),
        customPrice: newSubscription.customPrice !== null ? Number(newSubscription.customPrice) : null,
        features: newSubscription.customFeatures,
        userLimit: newSubscription.customUserLimit,
        leadLimit: newSubscription.customLeadLimit,
        schedulesCount: generatedSchedules.length,
      },
    };
  }

  /**
   * Get authenticated customer profile strictly isolated by JWT identity.
   */
  async getMe(user: any) {
    const userId = Number(user?.id || user?.userId || user?.sub);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('Invalid user session');
    }

    const userRecord = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        customer: {
          include: {
            subscriptions: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { plan: true },
            },
          },
        },
      },
    });

    if (!userRecord || !userRecord.isActive || userRecord.deletedAt) {
      throw new UnauthorizedException('User account inactive or missing');
    }

    const customerId = userRecord.customerId || (user.customerId ? Number(user.customerId) : null);
    if (!customerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    const customer = userRecord.customer || (await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        subscriptions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plan: true },
        },
      },
    }));

    if (!customer || customer.deletedAt) {
      throw new NotFoundException('Customer profile not found');
    }

    const activeSub = customer.subscriptions[0];
    const qbCode = this.qbIdGenerator.generateQBUserId('CUSTOMER', customer.id);

    const safeCustomer = this.serializeBigInt(customer);

    return {
      success: true,
      data: {
        id: customer.id,
        customerId: qbCode,
        name: customer.name,
        companyName: customer.companyName || customer.name,
        domain: customer.domain,
        logo: customer.logo,
        profileImage: customer.logo || userRecord.avatar,
        phone: customer.phone || userRecord.phone,
        alternatePhone: customer.alternatePhone,
        email: customer.email || userRecord.email,
        address: customer.address,
        city: customer.city,
        state: customer.state,
        country: customer.country || 'India',
        pincode: customer.pincode,
        customerType: customer.customerType || 'ENTERPRISE',
        industry: customer.industry || 'General',
        source: customer.source || 'DIRECT',
        assignedEmployee: customer.assignedEmployee,
        department: customer.department,
        notes: customer.notes,
        isActive: customer.isActive,
        userLimit: customer.userLimit,
        leadLimit: customer.leadLimit,
        storageUsed: Number(customer.storageUsed || 0),
        storageLimit: Number(customer.storageLimit || 0),
        plan: activeSub?.plan?.name ?? null,
        planCode: activeSub?.plan?.code ?? null,
        subscriptionStatus: activeSub?.status || 'ACTIVE',
        subscriptionStartDate: activeSub?.startDate,
        subscriptionEndDate: activeSub?.endDate,
        user: {
          id: userRecord.id,
          email: userRecord.email,
          phone: userRecord.phone,
          firstName: userRecord.firstName,
          lastName: userRecord.lastName,
          avatar: userRecord.avatar,
          designation: userRecord.designation,
        },
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
    };
  }

  /**
   * Update authenticated customer profile data.
   */
  async updateMe(user: any, dto: UpdateCustomerProfileDto) {
    const userId = Number(user?.id || user?.userId || user?.sub);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('Invalid user session');
    }

    const userRecord = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userRecord || !userRecord.isActive || userRecord.deletedAt) {
      throw new UnauthorizedException('User account inactive or missing');
    }

    const customerId = userRecord.customerId || (user.customerId ? Number(user.customerId) : null);
    if (!customerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    const existingCustomer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!existingCustomer || existingCustomer.deletedAt) {
      throw new NotFoundException('Customer profile not found');
    }

    const logoUrl = dto.logo !== undefined ? dto.logo : (dto.profileImage !== undefined ? dto.profileImage : undefined);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        name: dto.name !== undefined && dto.name.trim() !== '' ? dto.name.trim() : undefined,
        companyName: dto.companyName !== undefined && dto.companyName.trim() !== '' ? dto.companyName.trim() : undefined,
        phone: dto.phone !== undefined ? dto.phone.trim() : undefined,
        alternatePhone: dto.alternatePhone !== undefined ? dto.alternatePhone.trim() : undefined,
        address: dto.address !== undefined ? dto.address.trim() : undefined,
        city: dto.city !== undefined ? dto.city.trim() : undefined,
        state: dto.state !== undefined ? dto.state.trim() : undefined,
        country: dto.country !== undefined ? dto.country.trim() : undefined,
        pincode: dto.pincode !== undefined ? dto.pincode.trim() : undefined,
        industry: dto.industry !== undefined ? dto.industry.trim() : undefined,
        logo: logoUrl,
      },
    });

    // Optionally update user name if contactPerson is provided
    if (dto.contactPerson && dto.contactPerson.trim().length > 0) {
      const parts = dto.contactPerson.trim().split(/\s+/);
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ') || '';
      await this.prisma.user.update({
        where: { id: userRecord.id },
        data: {
          firstName,
          lastName: lastName.length > 0 ? lastName : userRecord.lastName,
        },
      });
    }

    return this.getMe(user);
  }

  async getCustomerProfile(userId: number, explicitCustomerId?: number | string) {
    return this.getMe({ id: userId, customerId: explicitCustomerId });
  }
}

