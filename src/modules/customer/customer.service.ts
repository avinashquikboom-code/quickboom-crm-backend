import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, RoleType } from '@prisma/client';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  UpdateCustomerProfileDto,
} from './dto/customer.dto';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { calculatePlanExpiry, calculateSubscriptionStartDate } from '../../common/utils/subscription-date.util';
import { isUserSuperAdmin, isUserAdmin, isUserAdminOrStaff } from '../../common/utils/role.util';
import { ResetCustomerDataDto } from './dto/reset-customer.dto';

/**
 * Filter conditions to strictly exclude Super Admin, Admin, and system accounts
 * from ever being returned or treated as customers.
 */
export const SYSTEM_CUSTOMER_EXCLUSIONS: Prisma.CustomerWhereInput[] = [
  // 1. Exclude customer records linked to Super Admin or Admin users
  {
    users: {
      some: {
        userRoles: {
          some: {
            role: {
              OR: [
                { type: RoleType.SUPER_ADMIN },
                { name: { in: ['SUPER_ADMIN', 'Super Administrator', 'Super Admin', 'ADMIN', 'Admin', 'System Admin'] } },
              ],
            },
          },
        },
      },
    },
  },
  // 2. Exclude customer records with explicit platform admin roles
  {
    roles: {
      some: {
        OR: [
          { type: RoleType.SUPER_ADMIN },
          { name: { in: ['SUPER_ADMIN', 'Super Administrator', 'Super Admin', 'ADMIN', 'Admin', 'System Admin'] } },
        ],
      },
    },
  },
  // 3. Exclude non-customer system account types
  {
    customerType: {
      in: ['SYSTEM', 'INTERNAL', 'SUPER_ADMIN', 'ADMIN'],
    },
  },
];

export interface UpcomingCallInfo {
  type: 'Final Call' | 'Next Call';
  callType: 'FINAL_CALL' | 'NEXT_CALL';
  date: string;
  formattedDate: string;
  time: string;
  formattedTime: string;
  scheduledAt: string;
  status: 'SCHEDULED';
  notes?: string;
}

export function parseCallDateTime(dateVal: Date | string, timeStr?: string | null): Date {
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return new Date(0);

  let year = d.getFullYear();
  let month = d.getMonth();
  let day = d.getDate();

  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal.trim())) {
    const parts = dateVal.trim().split('-').map(Number);
    year = parts[0];
    month = parts[1] - 1;
    day = parts[2];
  }

  let hours = d.getHours();
  let minutes = d.getMinutes();
  let hasExplicitTime = false;

  if (timeStr && typeof timeStr === 'string' && timeStr.trim()) {
    const trimmed = timeStr.trim();
    const match12 = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (match12) {
      let h = parseInt(match12[1], 10);
      const m = parseInt(match12[2], 10);
      const meridiem = match12[3]?.toUpperCase();
      if (meridiem === 'PM' && h < 12) h += 12;
      if (meridiem === 'AM' && h === 12) h = 0;
      hours = h;
      minutes = m;
      hasExplicitTime = true;
    } else {
      const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
      if (match24) {
        hours = parseInt(match24[1], 10);
        minutes = parseInt(match24[2], 10);
        hasExplicitTime = true;
      }
    }
  }

  if (!hasExplicitTime) {
    if (hours === 0 && minutes === 0) {
      hours = 23;
      minutes = 59;
    }
  }

  return new Date(year, month, day, hours, minutes, 0, 0);
}

export function formatCallDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatCallTime(d: Date, originalTimeStr?: string | null): string {
  if (originalTimeStr && /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(originalTimeStr.trim())) {
    const parts = originalTimeStr.trim().split(/\s+/);
    const timeParts = parts[0].split(':');
    const h = timeParts[0].padStart(2, '0');
    const m = timeParts[1].padStart(2, '0');
    const meridiem = parts[1].toUpperCase();
    return `${h}:${m} ${meridiem}`;
  }
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const meridiem = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const hStr = String(h).padStart(2, '0');
  return `${hStr}:${m} ${meridiem}`;
}

export function extractUpcomingCall(c: any, now: Date = new Date()): UpcomingCallInfo | null {
  const linkedLeads = [
    ...((c as any).originLead ? [(c as any).originLead] : []),
    ...((c as any).leads || []),
  ].filter((l: any) => l && !l.deletedAt);

  const candidates: Array<{
    type: 'Final Call' | 'Next Call';
    callType: 'FINAL_CALL' | 'NEXT_CALL';
    scheduledAt: Date;
    originalTime?: string | null;
    notes?: string;
  }> = [];

  for (const l of linkedLeads) {
    const st = String(l.status || '').toUpperCase();
    const stageKey = String(l.stage?.key || '').toUpperCase();
    const stageName = String(l.stage?.name || '').toLowerCase();

    // 1. Exclude terminal completed or cancelled leads
    const isCompletedOrCancelled =
      ['WON', 'CONVERTED', 'LOST', 'CANCELLED'].includes(st) ||
      ['WON', 'LOST', 'CANCELLED'].includes(stageKey) ||
      ['won', 'lost', 'cancelled'].includes(stageName);

    if (isCompletedOrCancelled) {
      continue;
    }

    const isFinalCall = st === 'FINAL_CALL' || stageKey === 'FINAL_CALL' || stageName.includes('final');

    if (isFinalCall) {
      let scheduledAt: Date;
      if (l.nextFollowUpDate) {
        scheduledAt = parseCallDateTime(l.nextFollowUpDate, l.nextFollowUpTime);
      } else {
        scheduledAt = new Date(now.getTime() + 3600000); // Default future time for final call stage
      }
      candidates.push({
        type: 'Final Call',
        callType: 'FINAL_CALL',
        scheduledAt: scheduledAt > now ? scheduledAt : new Date(now.getTime() + 3600000),
        originalTime: l.nextFollowUpTime || '11:00 AM',
        notes: l.workNotes || undefined,
      });
    } else if (l.nextFollowUpDate) {
      const callDateTime = parseCallDateTime(l.nextFollowUpDate, l.nextFollowUpTime);
      if (callDateTime > now) {
        candidates.push({
          type: 'Next Call',
          callType: 'NEXT_CALL',
          scheduledAt: callDateTime,
          originalTime: l.nextFollowUpTime,
          notes: l.workNotes || undefined,
        });
      }
    }

    // Active uncompleted reminders
    if (Array.isArray(l.reminders)) {
      for (const r of l.reminders) {
        if (!r.isCompleted && r.remindAt) {
          const remDate = new Date(r.remindAt);
          if (remDate > now) {
            const rIsFinal = isFinalCall || String(r.title || '').toLowerCase().includes('final');
            candidates.push({
              type: rIsFinal ? 'Final Call' : 'Next Call',
              callType: rIsFinal ? 'FINAL_CALL' : 'NEXT_CALL',
              scheduledAt: remDate,
              originalTime: null,
              notes: r.title,
            });
          }
        }
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const earliest = candidates[0];

  const formattedDate = formatCallDate(earliest.scheduledAt);
  const formattedTime = formatCallTime(earliest.scheduledAt, earliest.originalTime);
  const isoDate = `${earliest.scheduledAt.getFullYear()}-${String(earliest.scheduledAt.getMonth() + 1).padStart(2, '0')}-${String(earliest.scheduledAt.getDate()).padStart(2, '0')}`;

  return {
    type: earliest.type,
    callType: earliest.callType,
    date: isoDate,
    formattedDate,
    time: formattedTime,
    formattedTime,
    scheduledAt: earliest.scheduledAt.toISOString(),
    status: 'SCHEDULED',
    notes: earliest.notes,
  };
}

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
      NOT: SYSTEM_CUSTOMER_EXCLUSIONS,
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
          originLead: {
            include: { stage: true },
          },
          leads: {
            where: { deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 1,
            include: { stage: true },
          },
          works: {
            select: { id: true, status: true, title: true, scheduledDate: true },
            orderBy: { updatedAt: 'desc' },
            take: 5,
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
        where: { deletedAt: null, NOT: SYSTEM_CUSTOMER_EXCLUSIONS },
        include: {
          subscriptions: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { plan: true },
          },
          originLead: {
            include: { stage: true },
          },
          leads: {
            where: { deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 1,
            include: { stage: true },
          },
          works: {
            select: { id: true, status: true },
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

    // Helper to derive customer lifecycle status: ACTIVE, UPCOMING, COMPLETED
    const computeCustomerStatus = (c: any): 'ACTIVE' | 'UPCOMING' | 'COMPLETED' => {
      const sub = c.subscriptions?.[0];
      const works = c.works || [];
      const hasActiveWork = works.some((w: any) =>
        ['IN_PROGRESS', 'ASSIGNED', 'PROCESSING', 'SUBMITTED', 'CUSTOMER_REVIEW', 'REVISION_REQUESTED', 'APPROVED', 'UNDER_REVIEW'].includes(w.status),
      );
      const hasUpcomingWork = works.some((w: any) =>
        ['SCHEDULED'].includes(w.status),
      );
      const allWorksCompleted = works.length > 0 && works.every((w: any) =>
        ['COMPLETED', 'CANCELLED'].includes(w.status),
      );
      const subStatus = sub?.status;

      if (hasActiveWork || subStatus === 'ACTIVE') {
        return 'ACTIVE';
      }
      if (hasUpcomingWork || subStatus === 'PENDING' || subStatus === 'TRIAL') {
        return 'UPCOMING';
      }
      if (allWorksCompleted || subStatus === 'EXPIRED' || subStatus === 'CANCELED' || !c.isActive) {
        return 'COMPLETED';
      }
      return c.isActive ? 'ACTIVE' : 'COMPLETED';
    };

    // Calculate Global Aggregated KPIs
    let totalAllocatedSeats = 0;
    let totalMaxSeats = 0;
    let totalLeads = 0;
    let totalStorageBytes = 0;
    let activeCustomersCount = 0;
    let upcomingCustomersCount = 0;
    let completedCustomersCount = 0;

    for (const c of allCustomersStats as any[]) {
      const st = computeCustomerStatus(c);
      if (st === 'ACTIVE') activeCustomersCount++;
      else if (st === 'UPCOMING') upcomingCustomersCount++;
      else if (st === 'COMPLETED') completedCustomersCount++;

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
    let items = (customers as any[]).map((c) => {
      const sub = c.subscriptions?.[0];
      const users = c._count?.users || 0;
      const maxUsers = sub?.customUserLimit ?? sub?.plan?.userLimit ?? c.userLimit ?? 50;
      const leads = c._count?.leads || 0;
      const maxLeads = sub?.customLeadLimit ?? sub?.plan?.leadLimit ?? c.leadLimit ?? 500;
      const storageBytes = Number(c.storageUsed || 0);
      const maxStorageBytes = Number(sub?.customStorageLimit ?? sub?.plan?.storageLimit ?? c.storageLimit ?? 5368709120);
      const seatPct = maxUsers > 0 ? Math.min(100, Math.round((users / maxUsers) * 100)) : 0;
      const leadPct = maxLeads > 0 ? Math.min(100, Math.round((leads / maxLeads) * 100)) : 0;

      const customerStatus = computeCustomerStatus(c);
      const linkedLead = (c as any).originLead || c.leads?.[0];
      const leadStatus = linkedLead?.status || (c.leads?.length > 0 ? 'WON' : null);
      const leadStageName = linkedLead?.stage?.name || (leadStatus ? 'Won' : null);
      const leadStageColor = linkedLead?.stage?.color || (leadStatus === 'WON' ? '#10B981' : '#6366F1');
      const rawLeadId = linkedLead?.id ? String(linkedLead.id) : null;
      const contactPerson = linkedLead ? `${linkedLead.firstName || ''} ${linkedLead.lastName || ''}`.trim() : (c.name || '');

      return {
        id: c.id,
        customerId: `CUST-${c.id}`,
        name: c.name || c.companyName || `Customer #${c.id}`,
        companyName: c.companyName || c.name || '',
        contactPerson: contactPerson || c.name || 'Primary Contact',
        domain: c.domain || (c.email ? c.email.split('@')[1] : '') || 'N/A',
        email: c.email || linkedLead?.email || '',
        phone: c.phone || linkedLead?.phone || '',
        isActive: c.isActive,
        status: customerStatus,
        customerStatus: customerStatus,
        leadId: rawLeadId,
        leadStatus: leadStatus,
        leadStageName: leadStageName,
        leadStageColor: leadStageColor,
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

    if (query.status && query.status !== 'ALL' && query.status.trim() !== '') {
      const targetStatus = query.status.trim().toUpperCase();
      if (['ACTIVE', 'UPCOMING', 'COMPLETED'].includes(targetStatus)) {
        items = items.filter((item) => item.customerStatus === targetStatus);
      }
    }

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
        upcomingCustomers: upcomingCustomersCount,
        completedCustomers: completedCustomersCount,
      },
      meta: {
        counts: {
          active: activeCustomersCount,
          upcoming: upcomingCustomersCount,
          completed: completedCustomersCount,
          all: allCustomersStats.length,
        },
      },
      items,
      pagination: {
        total: items.length,
        page,
        limit,
        totalPages: Math.ceil(items.length / limit) || 1,
      },
    };
  }

  /**
   * Get KPI Summary metrics for Customer screen
   */
  async getMetrics() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const baseWhere: any = {
      deletedAt: null,
      NOT: SYSTEM_CUSTOMER_EXCLUSIONS,
    };

    const [totalCustomers, activeCustomers, inactiveCustomers, newCustomers, customersWithDeals] =
      await Promise.all([
        this.prisma.customer.count({ where: { ...baseWhere } }),
        this.prisma.customer.count({ where: { ...baseWhere, isActive: true } }),
        this.prisma.customer.count({ where: { ...baseWhere, isActive: false } }),
        this.prisma.customer.count({
          where: {
            ...baseWhere,
            createdAt: { gte: thirtyDaysAgo },
          },
        }),
        this.prisma.customer.count({
          where: {
            ...baseWhere,
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
    teamId?: number | string;
    assignedTeamId?: number | string;
    company?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    excludeAdmins?: boolean;
  }, user?: any) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const employeeId = user?.employeeId || user?.employee?.id;
    const companyId = user?.customerId || user?.employee?.customerId;
    const isSuperAdmin = isUserSuperAdmin(user);
    const isPrivilegedAdmin = isSuperAdmin || isUserAdmin(user);

    const where: any = {
      deletedAt: null,
    };

    // Customer directory and customer APIs must ALWAYS exclude Super Admin, Admin, and system accounts by default
    const shouldExcludeAdmins = query.excludeAdmins !== false;
    if (shouldExcludeAdmins) {
      where.NOT = SYSTEM_CUSTOMER_EXCLUSIONS;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    } else if (query.status && query.status !== 'ALL' && query.status.trim() !== '') {
      if (query.status.toUpperCase() === 'INACTIVE') {
        where.isActive = false;
      }
    }

    if (query.source && query.source !== 'ALL' && query.source.trim() !== '') {
      where.source = { equals: query.source.trim(), mode: 'insensitive' };
    }

    const filterTeamId = query.teamId || query.assignedTeamId;
    if (filterTeamId && filterTeamId !== 'ALL' && String(filterTeamId).trim() !== '') {
      const numTeam = Number(filterTeamId);
      if (!isNaN(numTeam) && numTeam > 0) {
        where.assignedTeamId = numTeam;
      }
    }

    const andConditions: any[] = [];

    // Strict Employee Scoping & Tenant Isolation (Requirements 1, 12, 13, 14)
    // The Customer screen is employee-specific. The authenticated employee should see only customers they are authorized to see:
    // 1. customer.assignedEmployeeId == loggedInEmployeeId
    // 2. customer.createdByEmployeeId == loggedInEmployeeId
    // 3. Or linked lead assigned to or created by that employee
    // Exclude unassigned, other employee's customers, and company-wide accounts.
    if (employeeId && !isPrivilegedAdmin) {
      andConditions.push({
        OR: [
          { assignedEmployeeId: employeeId },
          { createdByEmployeeId: employeeId },
          {
            leads: {
              some: {
                deletedAt: null,
                OR: [
                  { employeeId: employeeId },
                  { createdById: user?.id },
                  { assignedToId: user?.id },
                ],
              },
            },
          },
          {
            originLead: {
              deletedAt: null,
              OR: [
                { employeeId: employeeId },
                { createdById: user?.id },
                { assignedToId: user?.id },
              ],
            },
          },
        ],
      });
    }

    if (query.assignedEmployee && query.assignedEmployee !== 'ALL' && query.assignedEmployee.trim() !== '') {
      const trimmedEmp = query.assignedEmployee.trim();
      const numEmpId = Number(trimmedEmp);
      if (!isNaN(numEmpId) && numEmpId > 0) {
        andConditions.push({
          OR: [
            { assignedEmployeeId: numEmpId },
            { assignedEmployee: { contains: trimmedEmp, mode: 'insensitive' } },
          ],
        });
      } else {
        andConditions.push({
          OR: [
            { assignedEmployee: { contains: trimmedEmp, mode: 'insensitive' } },
            {
              assignedEmployeeRel: {
                OR: [
                  { firstName: { contains: trimmedEmp, mode: 'insensitive' } },
                  { lastName: { contains: trimmedEmp, mode: 'insensitive' } },
                ],
              },
            },
          ],
        });
      }
    }

    if (query.company && query.company.trim()) {
      const c = query.company.trim();
      andConditions.push({
        OR: [
          { name: { contains: c, mode: 'insensitive' } },
          { companyName: { contains: c, mode: 'insensitive' } },
        ],
      });
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      andConditions.push({
        OR: [
          { name: { contains: s, mode: 'insensitive' } },
          { companyName: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { phone: { contains: s, mode: 'insensitive' } },
          { city: { contains: s, mode: 'insensitive' } },
          { domain: { contains: s, mode: 'insensitive' } },
          {
            users: {
              some: {
                AND: [
                  { deletedAt: null },
                  {
                    OR: [
                      { email: { contains: s, mode: 'insensitive' } },
                      { phone: { contains: s, mode: 'insensitive' } },
                      { firstName: { contains: s, mode: 'insensitive' } },
                      { lastName: { contains: s, mode: 'insensitive' } },
                    ],
                  },
                  {
                    NOT: {
                      userRoles: {
                        some: {
                          role: {
                            OR: [
                              { type: RoleType.SUPER_ADMIN },
                              { name: { in: ['SUPER_ADMIN', 'Super Administrator', 'Super Admin', 'ADMIN', 'Admin', 'System Admin'] } },
                            ],
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
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
          assignedTeam: {
            select: {
              id: true,
              name: true,
              description: true,
              leader: {
                select: { id: true, firstName: true, lastName: true },
              },
              members: {
                include: {
                  employee: {
                    select: { id: true, firstName: true, lastName: true },
                  },
                },
              },
              _count: {
                select: { members: true },
              },
            },
          },
          assignedEmployeeRel: {
            include: { department: true, designation: true },
          },
          users: {
            where: { deletedAt: null },
            select: {
              id: true,
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
            },
            take: 5,
          },
          subscriptions: {
            where: { deletedAt: null },
            include: { plan: true },
            orderBy: { createdAt: 'desc' },
          },
          leads: {
            where: { deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            include: {
              stage: true,
              reminders: {
                where: { isCompleted: false },
                orderBy: { remindAt: 'asc' },
              },
            },
          },
          originLead: {
            include: {
              stage: true,
              reminders: {
                where: { isCompleted: false },
                orderBy: { remindAt: 'asc' },
              },
            },
          },
          tasks: {
            where: { deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
            select: { id: true, title: true, status: true, dueDate: true, dueAt: true },
          },
          works: {
            select: { id: true, status: true, title: true, scheduledDate: true },
            orderBy: { updatedAt: 'desc' },
            take: 5,
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
          aiWallet: {
            select: {
              id: true,
              balance: true,
              totalEarned: true,
              totalSpent: true,
            },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Helper to derive customer lifecycle status: ACTIVE, UPCOMING, COMPLETED
    const computeCustomerStatus = (c: any): 'ACTIVE' | 'UPCOMING' | 'COMPLETED' => {
      // 1. COMPLETED: Leads that reached WON / CONVERTED (Requirements 9, 10, 11)
      const linkedLeads = [
        ...((c as any).originLead ? [(c as any).originLead] : []),
        ...((c as any).leads || []),
      ];
      const hasWonLead = linkedLeads.some((l: any) => {
        const st = String(l.status || '').toUpperCase();
        const stageKey = String(l.stage?.key || '').toUpperCase();
        const stageName = String(l.stage?.name || '').toLowerCase();
        return st === 'WON' || st === 'CONVERTED' || stageKey === 'WON' || stageName === 'won';
      });

      if (hasWonLead) {
        return 'COMPLETED';
      }

      // 2. UPCOMING: Customers with upcoming scheduled call / follow-up / task / visit / activity (Requirements 6, 7, 8)
      // Note: Past completed call itself does NOT count as upcoming unless a future call/follow-up is scheduled
      const hasUpcomingCallOrFollowUp = linkedLeads.some((l: any) => {
        if (l.nextFollowUpDate && new Date(l.nextFollowUpDate) >= startOfToday) {
          return true;
        }
        if (Array.isArray(l.reminders) && l.reminders.some((r: any) => !r.isCompleted && new Date(r.remindAt) >= startOfToday)) {
          return true;
        }
        return false;
      });

      const hasUpcomingTask = ((c as any).tasks || []).some((t: any) => {
        const d = t.dueAt || t.dueDate;
        return d && new Date(d) >= startOfToday;
      });

      const works = (c as any).works || [];
      const hasUpcomingWork = works.some((w: any) =>
        ['SCHEDULED'].includes(w.status) && (!w.scheduledDate || new Date(w.scheduledDate) >= startOfToday),
      );

      const pendingSub = c.subscriptions?.find(
        (s: any) => s.status === 'PENDING' || s.status === 'TRIAL',
      );

      if (hasUpcomingCallOrFollowUp || hasUpcomingTask || hasUpcomingWork || pendingSub) {
        return 'UPCOMING';
      }

      // 3. COMPLETED: Inactive, expired subscriptions, or all works completed
      const allWorksCompleted = works.length > 0 && works.every((w: any) =>
        ['COMPLETED', 'CANCELLED'].includes(w.status),
      );
      const expiredSub = c.subscriptions?.find(
        (s: any) => s.status === 'EXPIRED' || s.status === 'CANCELED',
      );

      if (!c.isActive || allWorksCompleted || expiredSub) {
        return 'COMPLETED';
      }

      // 4. Default: ACTIVE
      return 'ACTIVE';
    };

    const countsWhere: any = {
      deletedAt: null,
      ...(shouldExcludeAdmins ? { NOT: SYSTEM_CUSTOMER_EXCLUSIONS } : {}),
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
      ...(where.createdAt ? { createdAt: where.createdAt } : {}),
      ...(where.source ? { source: where.source } : {}),
      ...(where.assignedTeamId ? { assignedTeamId: where.assignedTeamId } : {}),
    };

    // Calculate dynamic counts across customers for [ All ] [ Active ] [ Upcoming ] [ Inactive ] tabs
    const allCustomersForCounts = await this.prisma.customer.findMany({
      where: countsWhere,
      select: {
        id: true,
        isActive: true,
        subscriptions: {
          where: { deletedAt: null },
          select: { status: true, endDate: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        works: {
          select: { status: true, scheduledDate: true },
        },
        leads: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
            nextFollowUpDate: true,
            nextFollowUpTime: true,
            stage: { select: { name: true, key: true } },
            reminders: {
              where: { isCompleted: false },
              select: { remindAt: true, isCompleted: true, title: true },
            },
          },
        },
        originLead: {
          select: {
            id: true,
            status: true,
            nextFollowUpDate: true,
            nextFollowUpTime: true,
            stage: { select: { name: true, key: true } },
            reminders: {
              where: { isCompleted: false },
              select: { remindAt: true, isCompleted: true, title: true },
            },
          },
        },
        tasks: {
          where: { deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          select: { dueAt: true, dueDate: true },
        },
      },
    });

    let activeCount = 0;
    let upcomingCount = 0;
    let inactiveCount = 0;
    let completedCount = 0;
    for (const c of allCustomersForCounts) {
      const sub = c.subscriptions?.[0];
      const isSubActive = c.isActive && sub && sub.status === 'ACTIVE' && (!sub.endDate || new Date(sub.endDate) >= now);
      const call = extractUpcomingCall(c, now);
      if (call !== null) {
        upcomingCount++;
      }

      if (isSubActive) {
        activeCount++;
      } else if (call === null) {
        inactiveCount++;
      }

      const st = this.computeCustomerStatus(c);
      if (st === 'COMPLETED') {
        completedCount++;
      }
    }

    let formatted = items.map((c) => {
      const primaryUser = (c as any).users?.[0];
      // Find latest valid active subscription strictly
      const activeSub =
        c.subscriptions.find(
          (s) =>
            s.status === 'ACTIVE' &&
            (!s.endDate || new Date(s.endDate) >= now),
        );

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
      const mrr = activeSub?.plan
        ? billingCycle === 'YEARLY'
          ? Math.round(Number(activeSub.plan.yearlyPrice) / 12)
          : Math.round(Number(activeSub.plan.monthlyPrice))
        : 0;

      const resolvedAssignedName = c.assignedEmployeeRel
        ? `${c.assignedEmployeeRel.firstName} ${c.assignedEmployeeRel.lastName}`.trim()
        : (c.assignedEmployee || 'Unassigned');

      const resolvedDepartment =
        c.assignedEmployeeRel?.department?.name || c.department || 'General';

      const upcomingCall = extractUpcomingCall(c, now);
      const hasUpcomingCall = upcomingCall !== null;
      const customerStatus = this.computeCustomerStatus(c);
      const linkedLead = (c as any).originLead || (c as any).leads?.[0];
      const rawLeadId = linkedLead?.id ? String(linkedLead.id) : (c.leadId ? String(c.leadId) : null);
      const leadStatus = linkedLead?.status || (c.leads?.length > 0 || c.leadId ? 'WON' : null);
      const leadStageName = linkedLead?.stage?.name || (leadStatus ? 'Won' : null);
      const leadStageColor = linkedLead?.stage?.color || (leadStatus === 'WON' ? '#10B981' : '#6366F1');
      const leadStageId = linkedLead?.stage?.id || linkedLead?.stageId || null;
      const contactPerson = primaryUser
        ? `${primaryUser.firstName || ''} ${primaryUser.lastName || ''}`.trim()
        : (linkedLead ? `${linkedLead.firstName || ''} ${linkedLead.lastName || ''}`.trim() : (c.name || 'Primary Contact'));

      return {
        id: c.id,
        customerId: `CUST-${String(c.id).padStart(4, '0')}`,
        name: c.name,
        customerName: c.name,
        companyName: c.companyName || c.name,
        company: c.companyName || c.name,
        workspaceName: c.companyName || c.name,
        contactFirstName: primaryUser?.firstName || '',
        contactLastName: primaryUser?.lastName || '',
        contactFullName: contactPerson,
        contactPerson: contactPerson,
        domain: c.domain,
        email: c.email || primaryUser?.email || linkedLead?.email || 'N/A',
        phone: c.phone || primaryUser?.phone || linkedLead?.phone || 'N/A',
        alternatePhone: c.alternatePhone,
        address: c.address || linkedLead?.address,
        city: c.city || linkedLead?.city || 'N/A',
        state: c.state || linkedLead?.state || 'N/A',
        country: c.country || 'India',
        pincode: c.pincode,
        customerType: c.customerType || 'ENTERPRISE',
        industry: c.industry || 'General',
        source: c.source || linkedLead?.source || 'DIRECT',
        teamId: c.assignedTeamId,
        team: (c as any).assignedTeam
          ? {
              id: (c as any).assignedTeam.id,
              name: (c as any).assignedTeam.name,
              description: (c as any).assignedTeam.description,
              leader: (c as any).assignedTeam.leader
                ? `${(c as any).assignedTeam.leader.firstName || ''} ${(c as any).assignedTeam.leader.lastName || ''}`.trim()
                : null,
              memberCount:
                (c as any).assignedTeam._count?.members ||
                ((c as any).assignedTeam.members || []).length,
            }
          : null,
        assignedEmployeeId: c.assignedEmployeeId,
        assignedEmployee: resolvedAssignedName,
        department: resolvedDepartment,
        notes: c.notes || linkedLead?.workNotes,
        isActive: c.isActive,
        status: customerStatus,
        customerStatus,
        upcomingCall: upcomingCall || null,
        hasUpcomingCall,
        upcomingCallType: upcomingCall?.type || null,
        upcomingCallDate: upcomingCall?.formattedDate || null,
        upcomingCallTime: upcomingCall?.formattedTime || null,
        leadId: rawLeadId,
        leadStatus,
        leadStageId,
        leadStageName,
        leadStageColor,
        lead: linkedLead
          ? {
              id: linkedLead.id,
              status: linkedLead.status,
              stageId: leadStageId,
              stage: linkedLead.stage
                ? {
                    id: linkedLead.stage.id,
                    name: linkedLead.stage.name,
                    color: linkedLead.stage.color,
                    key: linkedLead.stage.key,
                  }
                : (leadStageName
                    ? {
                        id: leadStageId,
                        name: leadStageName,
                        color: leadStageColor,
                      }
                    : null),
            }
          : null,
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
        aiCredits: (c as any).aiWallet?.balance ?? 20,
        aiWallet: (c as any).aiWallet || { balance: 20, totalEarned: 20, totalSpent: 0 },
        lastActivity: c.updatedAt,
        createdAt: c.createdAt,
      };
    });

    if (query.status && query.status !== 'ALL' && query.status.trim() !== '') {
      const targetStatus = query.status.trim().toUpperCase();
      if (targetStatus === 'UPCOMING') {
        formatted = formatted.filter((item) => item.hasUpcomingCall === true);
      } else if (targetStatus === 'ACTIVE') {
        formatted = formatted.filter((item) => item.subscriptionStatus === 'ACTIVE' || item.isActive === true);
      } else if (targetStatus === 'INACTIVE') {
        formatted = formatted.filter((item) => item.subscriptionStatus !== 'ACTIVE' && item.isActive === false);
      } else if (targetStatus === 'COMPLETED') {
        formatted = formatted.filter((item) => item.customerStatus === 'COMPLETED' || item.leadStatus === 'WON');
      }
    }

    const effectiveTotal = (query.status && query.status !== 'ALL') ? formatted.length : total;
    const totalPages = Math.ceil(effectiveTotal / limit) || 1;

    // Safe Logs
    const safeFilter = query.status || 'ALL';
    const safeSearch = query.search ? query.search.trim().slice(0, 50) : '';
    this.logger.log(
      `[CUSTOMERS] employeeId=${employeeId || 'none'} companyId=${companyId || 'none'} filter=${safeFilter} search=${safeSearch} count=${formatted.length}`,
    );

    for (const c of formatted) {
      this.logger.log(
        `[CUSTOMER_LEAD] customerId=${c.id} leadId=${c.leadId || 'none'} leadStageId=${(c as any).lead?.stage?.id || (c as any).leadStageId || 'none'} leadStageName=${c.leadStageName || 'none'}`,
      );
    }

    return {
      data: formatted,
      items: formatted,
      pagination: {
        page,
        pageSize: limit,
        total: effectiveTotal,
        totalPages,
      },
      meta: {
        total: effectiveTotal,
        page,
        limit,
        totalPages,
        counts: {
          all: allCustomersForCounts.length,
          active: activeCount,
          upcoming: upcomingCount,
          inactive: inactiveCount,
          completed: completedCount,
        },
      },
    };
  }

  /**
   * Helper to derive customer lifecycle status: ACTIVE, UPCOMING, COMPLETED
   */
  public computeCustomerStatus(c: any): 'ACTIVE' | 'UPCOMING' | 'COMPLETED' {
    const call = extractUpcomingCall(c);
    if (call !== null) {
      return 'UPCOMING';
    }
    const linkedLeads = [
      ...((c as any).originLead ? [(c as any).originLead] : []),
      ...((c as any).leads || []),
    ];
    const hasWonLead = linkedLeads.some((l: any) => {
      const st = String(l?.status || '').toUpperCase();
      const stageKey = String(l?.stage?.key || '').toUpperCase();
      const stageName = String(l?.stage?.name || '').toLowerCase();
      return st === 'WON' || st === 'CONVERTED' || stageKey === 'WON' || stageName === 'won';
    });

    if (hasWonLead) {
      return 'COMPLETED';
    }

    const sub = c.subscriptions?.[0];
    const isSubActive = c.isActive && sub && sub.status === 'ACTIVE' && (!sub.endDate || new Date(sub.endDate) >= new Date());
    if (isSubActive) {
      return 'ACTIVE';
    }
    return c.isActive ? 'ACTIVE' : 'COMPLETED';
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
  async findOne(id: number | string, user?: any) {
    const numericId = this.parseCustomerId(id);
    this.logger.log(
      `[GET_CUSTOMER_DETAILS] Fetching details for customerId=${numericId}`,
    );
    const customer = await this.prisma.customer.findUnique({
      where: { id: numericId },
      include: {
        assignedTeam: {
          include: {
            leader: {
              select: { id: true, firstName: true, lastName: true, email: true, phone: true },
            },
            members: {
              include: {
                employee: {
                  select: { id: true, firstName: true, lastName: true, email: true, phone: true },
                },
              },
            },
            _count: {
              select: { members: true },
            },
          },
        },
        assignedEmployeeRel: {
          include: { department: true, designation: true },
        },
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
        leads: {
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          include: {
            stage: true,
            reminders: {
              where: { isCompleted: false },
              select: { id: true, remindAt: true, title: true, isCompleted: true },
            },
          },
        },
        originLead: {
          include: {
            stage: true,
            reminders: {
              where: { isCompleted: false },
              select: { id: true, remindAt: true, title: true, isCompleted: true },
            },
          },
        },
        works: {
          select: { id: true, status: true, title: true, scheduledDate: true },
          orderBy: { updatedAt: 'desc' },
          take: 5,
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

    // Tenant / Role Authorization Check
    if (user && !isUserSuperAdmin(user)) {
      const callerCustomerId = Number(user.customerId);
      const isAssignedEmployee =
        Boolean(user.employee && customer.assignedEmployeeId === user.employee.id);

      const isAssignedTeamMember = Boolean(
        user.employee &&
        (customer.assignedTeam as any)?.members?.some(
          (m: any) => m.employeeId === user.employee.id || m.employee?.id === user.employee.id,
        ),
      );

      // Check if caller is user belonging to this customer
      const isCustomerUser =
        callerCustomerId === numericId ||
        customer.users.some((u) => u.id === user.id);

      const isCreatorEmployee = Boolean(user.employee && customer.createdByEmployeeId === user.employee.id);
      const isLeadEmployee = Boolean(
        user.employee &&
        customer.leads?.some(
          (l: any) => l.employeeId === user.employee.id || l.createdById === user.id || l.assignedToId === user.id,
        ),
      );

      if (!isCustomerUser && !isAssignedEmployee && !isCreatorEmployee && !isLeadEmployee && !isAssignedTeamMember) {
        throw new ForbiddenException(
          'You do not have permission to access details for this customer.',
        );
      }
    }

    const now = new Date();
    const activeSub =
      customer.subscriptions.find(
        (s) =>
          s.status === 'ACTIVE' &&
          (!s.endDate || new Date(s.endDate) >= now),
      );

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

    const resolvedAssignedName = customer.assignedEmployeeRel
      ? `${customer.assignedEmployeeRel.firstName} ${customer.assignedEmployeeRel.lastName}`.trim()
      : (customer.assignedEmployee || 'Unassigned');

    const resolvedDepartment =
      customer.assignedEmployeeRel?.department?.name || customer.department || 'General';

    const assignedTeamObj = (customer as any).assignedTeam;
    const customerStatus = this.computeCustomerStatus(customer);
    const linkedLead = (customer as any).originLead || (customer as any).leads?.[0];
    const rawLeadId = linkedLead?.id ? String(linkedLead.id) : (customer.leadId ? String(customer.leadId) : null);
    const leadStatus = linkedLead?.status || ((customer as any).leads?.length > 0 || customer.leadId ? 'WON' : null);
    const leadStageName = linkedLead?.stage?.name || (leadStatus ? 'Won' : null);
    const leadStageColor = linkedLead?.stage?.color || (leadStatus === 'WON' ? '#10B981' : '#6366F1');
    const leadStageId = linkedLead?.stage?.id || linkedLead?.stageId || null;

    const upcomingCall = extractUpcomingCall(customer, now);
    const hasUpcomingCall = upcomingCall !== null;

    return {
      ...safeCustomer,
      customerId: `CUST-${String(customer.id).padStart(4, '0')}`,
      company: customer.companyName || customer.name,
      status: customerStatus,
      customerStatus,
      upcomingCall: upcomingCall || null,
      hasUpcomingCall,
      upcomingCallType: upcomingCall?.type || null,
      upcomingCallDate: upcomingCall?.formattedDate || null,
      upcomingCallTime: upcomingCall?.formattedTime || null,
      leadId: rawLeadId,
      leadStatus,
      leadStageId,
      leadStageName,
      leadStageColor,
      lead: linkedLead
        ? {
            id: linkedLead.id,
            status: linkedLead.status,
            stageId: leadStageId,
            stage: linkedLead.stage
              ? {
                  id: linkedLead.stage.id,
                  name: linkedLead.stage.name,
                  color: linkedLead.stage.color,
                  key: linkedLead.stage.key,
                }
              : (leadStageName
                  ? {
                      id: leadStageId,
                      name: leadStageName,
                      color: leadStageColor,
                    }
                  : null),
          }
        : null,
      teamId: customer.assignedTeamId,
      team: assignedTeamObj
        ? {
            id: assignedTeamObj.id,
            name: assignedTeamObj.name,
            description: assignedTeamObj.description,
            leader: assignedTeamObj.leader
              ? `${assignedTeamObj.leader.firstName || ''} ${assignedTeamObj.leader.lastName || ''}`.trim()
              : null,
            memberCount:
              assignedTeamObj._count?.members ||
              (assignedTeamObj.members || []).length,
            members: (assignedTeamObj.members || []).map((m: any) => ({
              id: m.employee?.id || m.employeeId,
              name: `${m.employee?.firstName || ''} ${m.employee?.lastName || ''}`.trim() || 'Team Member',
              email: m.employee?.email,
              phone: m.employee?.phone,
              role: m.role,
            })),
          }
        : null,
      assignedEmployeeId: customer.assignedEmployeeId,
      assignedEmployee: resolvedAssignedName,
      department: resolvedDepartment,
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
  async create(dto: CreateCustomerDto, user?: any) {
    const normalizedEmail = dto.email?.trim().toLowerCase();
    if (normalizedEmail) {
      const existing = await this.prisma.customer.findFirst({
        where: { email: normalizedEmail, deletedAt: null },
      });
      if (existing) {
        throw new ConflictException({
          success: false,
          message: 'A customer with this email is already registered.',
          error: 'CUSTOMER_ALREADY_EXISTS',
        });
      }
    }

    let assignedTeamId: number | null = dto.assignedTeamId !== undefined
      ? (dto.assignedTeamId ? Number(dto.assignedTeamId) : null)
      : (dto.teamId !== undefined ? (dto.teamId ? Number(dto.teamId) : null) : null);

    if (assignedTeamId) {
      const team = await this.prisma.team.findUnique({
        where: { id: assignedTeamId },
      });
      if (!team) {
        throw new NotFoundException(`Team #${assignedTeamId} not found.`);
      }
    }

    const callerEmpId = user?.employeeId || user?.employee?.id;
    let createdByEmpId: number | null = dto.createdByEmployeeId ? Number(dto.createdByEmployeeId) : (callerEmpId ? Number(callerEmpId) : null);

    let assignedEmpId: number | null = dto.assignedEmployeeId ? Number(dto.assignedEmployeeId) : null;
    let assignedEmpName: string | null = dto.assignedEmployee || null;
    let resolvedDepartment: string | null = dto.department || null;

    // If assigned employee was not provided and creator is an employee, default assigned to creator
    if (!assignedEmpId && callerEmpId && !dto.assignedEmployee) {
      assignedEmpId = Number(callerEmpId);
      if (user?.employee) {
        assignedEmpName = `${user.employee.firstName} ${user.employee.lastName}`.trim();
        if (!resolvedDepartment && user.employee.department?.name) {
          resolvedDepartment = user.employee.department.name;
        }
      }
    }

    if (assignedEmpId) {
      const emp = await this.prisma.employee.findUnique({
        where: { id: assignedEmpId },
        include: { department: true },
      });
      if (emp) {
        assignedEmpName = `${emp.firstName} ${emp.lastName}`.trim();
        if (!resolvedDepartment && emp.department?.name) {
          resolvedDepartment = emp.department.name;
        }
      } else {
        assignedEmpId = null;
      }
    } else if (assignedEmpName && assignedEmpName !== 'Unassigned') {
      const parts = assignedEmpName.trim().split(/\s+/);
      const emp = await this.prisma.employee.findFirst({
        where: {
          OR: [
            { firstName: { contains: parts[0], mode: 'insensitive' } },
            { lastName: { contains: parts[parts.length - 1], mode: 'insensitive' } },
          ],
        },
        include: { department: true },
      });
      if (emp) {
        assignedEmpId = emp.id;
        if (!resolvedDepartment && emp.department?.name) {
          resolvedDepartment = emp.department.name;
        }
      }
    }

    const customer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          name: dto.name,
          companyName: dto.companyName || dto.name,
          domain: dto.domain,
          email: normalizedEmail || null,
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
          assignedTeamId: assignedTeamId,
          assignedEmployeeId: assignedEmpId,
          assignedEmployee: assignedEmpName,
          createdByEmployeeId: createdByEmpId,
          department: resolvedDepartment,
          notes: dto.notes,
          userLimit: dto.userLimit || 15,
          leadLimit: dto.leadLimit || 1000,
        },
        include: {
          assignedTeam: {
            select: {
              id: true,
              name: true,
              description: true,
              leader: { select: { id: true, firstName: true, lastName: true } },
              _count: { select: { members: true } },
            },
          },
        },
      });

      return created;
    });

    const safeCustomer = this.serializeBigInt(customer);
    const assignedTeamObj = (customer as any).assignedTeam;
    return {
      ...safeCustomer,
      teamId: safeCustomer.assignedTeamId,
      team: assignedTeamObj
        ? {
            id: assignedTeamObj.id,
            name: assignedTeamObj.name,
            description: assignedTeamObj.description,
            leader: assignedTeamObj.leader
              ? `${assignedTeamObj.leader.firstName || ''} ${assignedTeamObj.leader.lastName || ''}`.trim()
              : null,
            memberCount: assignedTeamObj._count?.members || 0,
          }
        : null,
    };
  }

  /**
   * Update Customer
   */
  async update(id: number | string, dto: UpdateCustomerDto) {
    const numericId = this.parseCustomerId(id);
    const existing = await this.prisma.customer.findUnique({
      where: { id: numericId },
    });

    if (!existing) {
      throw new NotFoundException(`Customer #${id} not found.`);
    }

    let assignedTeamId: number | null | undefined = undefined;
    if (dto.assignedTeamId !== undefined) {
      assignedTeamId = dto.assignedTeamId ? Number(dto.assignedTeamId) : null;
    } else if (dto.teamId !== undefined) {
      assignedTeamId = dto.teamId ? Number(dto.teamId) : null;
    }

    if (assignedTeamId) {
      const team = await this.prisma.team.findUnique({
        where: { id: assignedTeamId },
      });
      if (!team) {
        throw new NotFoundException(`Team #${assignedTeamId} not found.`);
      }
    }

    let assignedEmpId: number | null | undefined = undefined;
    let assignedEmpName: string | null | undefined = undefined;
    let resolvedDepartment: string | undefined = dto.department;

    if (dto.assignedEmployeeId !== undefined) {
      if (dto.assignedEmployeeId) {
        const emp = await this.prisma.employee.findUnique({
          where: { id: Number(dto.assignedEmployeeId) },
          include: { department: true },
        });
        if (emp) {
          assignedEmpId = emp.id;
          assignedEmpName = `${emp.firstName} ${emp.lastName}`.trim();
          if (!resolvedDepartment && emp.department?.name) {
            resolvedDepartment = emp.department.name;
          }
        } else {
          assignedEmpId = null;
          assignedEmpName = null;
        }
      } else {
        assignedEmpId = null;
        assignedEmpName = null;
      }
    } else if (dto.assignedEmployee !== undefined) {
      assignedEmpName = dto.assignedEmployee;
    }

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
        assignedTeamId: assignedTeamId !== undefined ? assignedTeamId : undefined,
        assignedEmployeeId: assignedEmpId !== undefined ? assignedEmpId : undefined,
        assignedEmployee: assignedEmpName !== undefined ? assignedEmpName : undefined,
        department: resolvedDepartment !== undefined ? resolvedDepartment : undefined,
        notes: dto.notes,
        isActive:
          dto.isActive !== undefined
            ? dto.isActive
            : dto.status !== undefined
            ? dto.status === 'ACTIVE'
            : undefined,
        deletedAt:
          dto.isActive === true || dto.status === 'ACTIVE'
            ? null
            : undefined,
        userLimit: dto.userLimit,
        leadLimit: dto.leadLimit,
      },
      include: {
        assignedTeam: {
          select: {
            id: true,
            name: true,
            description: true,
            leader: { select: { id: true, firstName: true, lastName: true } },
            _count: { select: { members: true } },
          },
        },
      },
    });

    if (assignedTeamId && this.workService && typeof this.workService.syncCustomerTeamWorkAssignments === 'function') {
      try {
        await this.workService.syncCustomerTeamWorkAssignments(numericId, assignedTeamId);
      } catch (syncErr: any) {
        this.logger.warn(`Failed to sync team work assignments for customer ${numericId}: ${syncErr?.message}`);
      }
    }

    const safeUpdated = this.serializeBigInt(updated);
    const assignedTeamObj = (updated as any).assignedTeam;
    return {
      ...safeUpdated,
      teamId: safeUpdated.assignedTeamId,
      team: assignedTeamObj
        ? {
            id: assignedTeamObj.id,
            name: assignedTeamObj.name,
            description: assignedTeamObj.description,
            leader: assignedTeamObj.leader
              ? `${assignedTeamObj.leader.firstName || ''} ${assignedTeamObj.leader.lastName || ''}`.trim()
              : null,
            memberCount: assignedTeamObj._count?.members || 0,
          }
        : null,
    };
  }

  /**
   * Get assigned team for a customer
   */
  async getAssignedTeam(id: number | string, user?: any) {
    const numericId = this.parseCustomerId(id);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numericId },
      include: {
        assignedTeam: {
          include: {
            leader: {
              select: { id: true, firstName: true, lastName: true, email: true, phone: true },
            },
            members: {
              include: {
                employee: {
                  select: { id: true, firstName: true, lastName: true, email: true, phone: true },
                },
              },
            },
            _count: {
              select: { members: true },
            },
          },
        },
        users: {
          where: { deletedAt: null },
          select: { id: true },
        },
      },
    });

    if (!customer || customer.deletedAt) {
      throw new NotFoundException(`Customer #${id} not found.`);
    }

    if (user && !isUserSuperAdmin(user)) {
      const callerCustomerId = Number(user.customerId);
      const isStaff = isUserAdminOrStaff(user);
      const isCustomerUser =
        callerCustomerId === numericId ||
        customer.users.some((u) => u.id === user.id);

      if (!isStaff && !isCustomerUser) {
        throw new ForbiddenException(
          'You do not have permission to view team assignment for this customer.',
        );
      }
    }

    const assignedTeamObj = (customer as any).assignedTeam;
    const teamData = assignedTeamObj
      ? {
          id: assignedTeamObj.id,
          name: assignedTeamObj.name,
          description: assignedTeamObj.description,
          leader: assignedTeamObj.leader
            ? `${assignedTeamObj.leader.firstName || ''} ${assignedTeamObj.leader.lastName || ''}`.trim()
            : null,
          memberCount:
            assignedTeamObj._count?.members ||
            (assignedTeamObj.members || []).length,
          members: (assignedTeamObj.members || []).map((m: any) => ({
            id: m.employee?.id || m.employeeId,
            name: `${m.employee?.firstName || ''} ${m.employee?.lastName || ''}`.trim() || 'Team Member',
            email: m.employee?.email,
            phone: m.employee?.phone,
            role: m.role,
          })),
        }
      : null;

    return {
      statusCode: 200,
      success: true,
      message: 'Assigned team retrieved successfully.',
      data: {
        customerId: numericId,
        teamId: customer.assignedTeamId,
        team: teamData,
      },
      customerId: numericId,
      teamId: customer.assignedTeamId,
      team: teamData,
    };
  }

  /**
   * Assign or reassign customer to an operating team
   */
  async assignTeam(id: number | string, teamId?: number | null, user?: any) {
    const numericId = this.parseCustomerId(id);

    // Role authorization check: only super admin or admin/staff can assign teams
    if (user && !isUserAdminOrStaff(user)) {
      throw new ForbiddenException(
        'You do not have permission to assign teams to customers.',
      );
    }

    const existing = await this.prisma.customer.findUnique({
      where: { id: numericId },
    });

    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Customer #${id} not found.`);
    }

    const resolvedTeamId = teamId ? Number(teamId) : null;
    if (resolvedTeamId) {
      const team = await this.prisma.team.findUnique({
        where: { id: resolvedTeamId },
      });
      if (!team) {
        throw new NotFoundException(`Team #${resolvedTeamId} not found.`);
      }
    }

    const updated = await this.prisma.customer.update({
      where: { id: numericId },
      data: { assignedTeamId: resolvedTeamId },
      include: {
        assignedTeam: {
          include: {
            leader: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
            members: {
              include: {
                employee: {
                  select: { id: true, firstName: true, lastName: true, email: true, phone: true },
                },
              },
            },
            _count: { select: { members: true } },
          },
        },
      },
    });

    if (resolvedTeamId && this.workService && typeof this.workService.syncCustomerTeamWorkAssignments === 'function') {
      try {
        await this.workService.syncCustomerTeamWorkAssignments(numericId, resolvedTeamId);
      } catch (syncErr: any) {
        this.logger.warn(`Failed to sync team work assignments for customer ${numericId}: ${syncErr?.message}`);
      }
    }

    const safeUpdated = this.serializeBigInt(updated);
    const assignedTeamObj = (updated as any).assignedTeam;
    const teamData = assignedTeamObj
      ? {
          id: assignedTeamObj.id,
          name: assignedTeamObj.name,
          description: assignedTeamObj.description,
          leader: assignedTeamObj.leader
            ? `${assignedTeamObj.leader.firstName || ''} ${assignedTeamObj.leader.lastName || ''}`.trim()
            : null,
          memberCount:
            assignedTeamObj._count?.members ||
            (assignedTeamObj.members || []).length,
          members: (assignedTeamObj.members || []).map((m: any) => ({
            id: m.employee?.id || m.employeeId,
            name: `${m.employee?.firstName || ''} ${m.employee?.lastName || ''}`.trim() || 'Team Member',
            email: m.employee?.email,
            phone: m.employee?.phone,
            role: m.role,
          })),
        }
      : null;

    return {
      statusCode: 200,
      success: true,
      message: resolvedTeamId
        ? 'Customer successfully assigned to team.'
        : 'Customer team unassigned.',
      data: {
        ...safeUpdated,
        customerId: numericId,
        teamId: safeUpdated.assignedTeamId,
        team: teamData,
      },
      customerId: numericId,
      teamId: safeUpdated.assignedTeamId,
      team: teamData,
    };
  }

  /**
   * Permanently delete customer from database (hard-delete).
   * Irreversibly cascades across all child records and deletes the customer row.
   * Atomic Prisma transaction with post-commit verification.
   * Tenant isolation: non-super-admin can only delete their own customer.
   */
  async remove(id: number | string, user?: any, _hardDelete = true) {
    const numericId = this.parseCustomerId(id);
    const existing = await this.prisma.customer.findUnique({
      where: { id: numericId },
    });

    if (!existing) {
      throw new NotFoundException(`Customer #${id} not found.`);
    }

    // Tenant Isolation Check
    if (user && !isUserSuperAdmin(user)) {
      const callerCustomerId = Number(user.customerId);
      if (!callerCustomerId || callerCustomerId !== numericId) {
        throw new ForbiddenException('You do not have permission to delete this customer.');
      }
    }

    // PERMANENT CASCADE DELETE
    const result = await this.prisma.$transaction(async (tx) => {
      // 0. Detach customer self-referencing / assigned employee / team pointers
      await tx.customer.update({
        where: { id: numericId },
        data: { assignedEmployeeId: null, assignedTeamId: null },
      });

      // 1. Delete FK-restricted application records before customer-owned parents
      await tx.leadActivityTimeline?.deleteMany?.({ where: { lead: { customerId: numericId } } });
      await tx.leadNote?.deleteMany?.({ where: { lead: { customerId: numericId } } });
      await tx.leadReminder?.deleteMany?.({ where: { lead: { customerId: numericId } } });
      await tx.leadStatusHistory?.deleteMany?.({ where: { lead: { customerId: numericId } } });
      await tx.taskReview?.deleteMany?.({ where: { task: { customerId: numericId } } });
      await tx.taskProof?.deleteMany?.({ where: { task: { customerId: numericId } } });
      await tx.taskHistory?.deleteMany?.({ where: { task: { customerId: numericId } } });
      await tx.ticketComment?.deleteMany?.({ where: { ticket: { customerId: numericId } } });
      await tx.communicationHistory?.deleteMany?.({ where: { contact: { customerId: numericId } } });
      await tx.workTask?.deleteMany?.({ where: { work: { customerId: numericId } } });
      await tx.attendanceBreak?.deleteMany?.({ where: { attendance: { customerId: numericId } } });

      // 2. Billing & Invoices & CRM & Operations
      await tx.subscriptionInstallment?.deleteMany?.({ where: { customerId: numericId } });
      await tx.invoiceItem?.deleteMany?.({ where: { invoice: { customerId: numericId } } });
      await tx.invoice?.deleteMany?.({ where: { customerId: numericId } });
      await tx.quotationItem?.deleteMany?.({ where: { quotation: { customerId: numericId } } });
      await tx.quotation?.deleteMany?.({ where: { customerId: numericId } });
      await tx.visit?.deleteMany?.({ where: { customerId: numericId } });
      await tx.task?.deleteMany?.({ where: { customerId: numericId } });
      await tx.deal?.deleteMany?.({ where: { customerId: numericId } });
      await tx.contact?.deleteMany?.({ where: { customerId: numericId } });
      await tx.lead?.deleteMany?.({ where: { customerId: numericId } });
      await tx.company?.deleteMany?.({ where: { customerId: numericId } });
      await tx.supportTicket?.deleteMany?.({ where: { customerId: numericId } });
      await tx.work?.deleteMany?.({ where: { customerId: numericId } });
      await tx.attendance?.deleteMany?.({ where: { customerId: numericId } });
      await tx.leaveRequest?.deleteMany?.({ where: { customerId: numericId } });
      await tx.remoteRequest?.deleteMany?.({ where: { customerId: numericId } });
      await tx.salarySlip?.deleteMany?.({ where: { customerId: numericId } });
      await tx.payrollItem?.deleteMany?.({ where: { customerId: numericId } });
      await tx.payroll?.deleteMany?.({ where: { customerId: numericId } });
      await tx.dataCapturePlace?.deleteMany?.({ where: { customerId: numericId } });
      await tx.dataCaptureJob?.deleteMany?.({ where: { customerId: numericId } });
      await tx.influencerBookingPayment?.deleteMany?.({ where: { customerId: numericId } });
      await tx.influencerBooking?.deleteMany?.({ where: { customerId: numericId } });
      await tx.influencerReview?.deleteMany?.({ where: { customerId: numericId } });
      await tx.aiGenerationAsset?.deleteMany?.({ where: { generation: { customerId: numericId } } });
      await tx.socialPublish?.deleteMany?.({ where: { customerId: numericId } });
      await tx.socialAccount?.deleteMany?.({ where: { customerId: numericId } });
      await tx.aiGeneration?.deleteMany?.({ where: { customerId: numericId } });
      await tx.aiCreditTransaction?.deleteMany?.({ where: { customerId: numericId } });
      await tx.aiCreditWallet?.deleteMany?.({ where: { customerId: numericId } });
      await tx.customerMarketingVideoView?.deleteMany?.({ where: { customerId: numericId } });
      await tx.paymentHistory?.deleteMany?.({ where: { customerId: numericId } });
      await tx.customPlanOrder?.deleteMany?.({ where: { customerId: numericId } });
      await tx.monthlySchedule?.deleteMany?.({ where: { customerId: numericId } });
      await tx.customerSubscription?.deleteMany?.({ where: { customerId: numericId } });

      // 3. Employee child records & HRMS policies
      await tx.salaryStructure?.deleteMany?.({ where: { employee: { customerId: numericId } } });
      await tx.employeeClaim?.deleteMany?.({ where: { customerId: numericId } });
      await tx.employeeLoan?.deleteMany?.({ where: { customerId: numericId } });
      await tx.employeeLocation?.deleteMany?.({ where: { customerId: numericId } });
      await tx.employeeLeaveBalance?.deleteMany?.({ where: { customerId: numericId } });
      await tx.leaveAdjustmentHistory?.deleteMany?.({ where: { customerId: numericId } });
      await tx.employeeModuleOverride?.deleteMany?.({ where: { customerId: numericId } });
      await tx.employeeLeadLimit?.deleteMany?.({ where: { customerId: numericId } });
      await tx.roleLeadLimit?.deleteMany?.({ where: { customerId: numericId } });
      await tx.roleWorkPermission?.deleteMany?.({ where: { customerId: numericId } });
      await tx.workAccessRequest?.deleteMany?.({ where: { customerId: numericId } });
      await tx.socialMediaHandler?.deleteMany?.({ where: { customerId: numericId } });
      await tx.marketingVideo?.deleteMany?.({ where: { customerId: numericId } });
      await tx.marketingBanner?.deleteMany?.({ where: { customerId: numericId } });
      await tx.trendingContent?.deleteMany?.({ where: { customerId: numericId } });
      await tx.branchGeofence?.deleteMany?.({ where: { customerId: numericId } });
      await tx.locationTrackingSetting?.deleteMany?.({ where: { customerId: numericId } });
      await tx.shiftGuidance?.deleteMany?.({ where: { customerId: numericId } });
      await tx.shift?.deleteMany?.({ where: { customerId: numericId } });
      await tx.publicHoliday?.deleteMany?.({ where: { customerId: numericId } });
      await tx.attendancePolicy?.deleteMany?.({ where: { customerId: numericId } });
      await tx.claimPolicy?.deleteMany?.({ where: { customerId: numericId } });
      await tx.leavePolicy?.deleteMany?.({ where: { customerId: numericId } });
      await tx.salaryPolicy?.deleteMany?.({ where: { customerId: numericId } });
      await tx.payrollPolicy?.deleteMany?.({ where: { customerId: numericId } });
      await tx.leadStage?.deleteMany?.({ where: { customerId: numericId } });
      await tx.pipeline?.deleteMany?.({ where: { customerId: numericId } });
      await tx.product?.deleteMany?.({ where: { customerId: numericId } });
      await tx.planEntitlement?.deleteMany?.({ where: { customerId: numericId } });
      await tx.featureToggle?.deleteMany?.({ where: { customerId: numericId } });
      await tx.notification?.deleteMany?.({ where: { customerId: numericId } });

      // 4. Invalidate auth sessions & tokens
      await tx.userRole?.deleteMany?.({ where: { user: { customerId: numericId } } });
      await tx.userDeviceToken?.deleteMany?.({ where: { user: { customerId: numericId } } });
      await tx.refreshToken?.deleteMany?.({ where: { user: { customerId: numericId } } });
      await tx.session?.deleteMany?.({ where: { user: { customerId: numericId } } });

      // 5. Delete employees, teams, designations, departments, roles, users, and customer row
      await tx.teamMember?.deleteMany?.({ where: { team: { customerId: numericId } } });
      await tx.team?.deleteMany?.({ where: { customerId: numericId } });
      await tx.auditLog?.deleteMany?.({ where: { customerId: numericId } });
      await tx.employee?.deleteMany?.({ where: { customerId: numericId } });
      await tx.designation?.deleteMany?.({ where: { customerId: numericId } });
      await tx.department?.deleteMany?.({ where: { customerId: numericId } });
      await tx.role?.deleteMany?.({ where: { customerId: numericId } });
      await tx.user?.deleteMany?.({ where: { customerId: numericId } });
      return tx.customer.delete({ where: { id: numericId } });
    });

    // 5. Post-commit verification
    const stillExists = await this.prisma.customer.findUnique({ where: { id: numericId } });
    if (stillExists) {
      throw new InternalServerErrorException(
        `Permanent deletion verification failed: Customer #${numericId} still exists in database.`,
      );
    }

    this.logger.log(`[CUSTOMER_PERMANENT_DELETE] Customer #${numericId} permanently deleted from database.`);
    return this.serializeBigInt(result);
  }

  /**
   * Get live summary of customer data that would be reset
   */
  async getResetSummary(id: number | string, user?: any) {
    const numericId = this.parseCustomerId(id);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numericId },
      select: {
        id: true,
        name: true,
        companyName: true,
        email: true,
        isActive: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${id} not found.`);
    }

    // Tenant Isolation Check
    if (user && !isUserSuperAdmin(user)) {
      const callerCustomerId = Number(user.customerId);
      if (!callerCustomerId || callerCustomerId !== numericId) {
        throw new ForbiddenException('You do not have permission to view data for this customer.');
      }
    }

    const [
      leadsCount,
      contactsCount,
      companiesCount,
      dealsCount,
      tasksCount,
      visitsCount,
      quotationsCount,
      invoicesCount,
      paymentsCount,
      installmentsCount,
      dataCapturePlacesCount,
      dataCaptureJobsCount,
      worksCount,
      monthlySchedulesCount,
      ticketsCount,
      notificationsCount,
      attendancesCount,
      breaksCount,
      leavesCount,
      remotesCount,
      locationsCount,
      payrollsCount,
      slipsCount,
      claimsCount,
      loansCount,
      marketingCount,
      socialCount,
      aiGenerationsCount,
      bookingsCount,
      // Protected Master data
      employeesCount,
      departmentsCount,
      designationsCount,
      usersCount,
      subscriptionsCount,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { customerId: numericId } }),
      this.prisma.contact.count({ where: { customerId: numericId } }),
      this.prisma.company.count({ where: { customerId: numericId } }),
      this.prisma.deal.count({ where: { customerId: numericId } }),
      this.prisma.task.count({ where: { customerId: numericId } }),
      this.prisma.visit.count({ where: { customerId: numericId } }),
      this.prisma.quotation.count({ where: { customerId: numericId } }),
      this.prisma.invoice.count({ where: { customerId: numericId } }),
      this.prisma.paymentHistory.count({ where: { customerId: numericId } }),
      this.prisma.subscriptionInstallment?.count
        ? this.prisma.subscriptionInstallment.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.dataCapturePlace?.count
        ? this.prisma.dataCapturePlace.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.dataCaptureJob?.count
        ? this.prisma.dataCaptureJob.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.work?.count
        ? this.prisma.work.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.monthlySchedule?.count
        ? this.prisma.monthlySchedule.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.supportTicket?.count
        ? this.prisma.supportTicket.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.notification?.count
        ? this.prisma.notification.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.attendance?.count
        ? this.prisma.attendance.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.attendanceBreak?.count
        ? this.prisma.attendanceBreak.count({ where: { attendance: { customerId: numericId } } })
        : Promise.resolve(0),
      this.prisma.leaveRequest?.count
        ? this.prisma.leaveRequest.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.remoteRequest?.count
        ? this.prisma.remoteRequest.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.employeeLocation?.count
        ? this.prisma.employeeLocation.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.payroll?.count
        ? this.prisma.payroll.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.salarySlip?.count
        ? this.prisma.salarySlip.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.employeeClaim?.count
        ? this.prisma.employeeClaim.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      this.prisma.employeeLoan?.count
        ? this.prisma.employeeLoan.count({ where: { customerId: numericId } })
        : Promise.resolve(0),
      // Marketing & Campaigns
      this.prisma.marketingBanner?.count
        ? this.prisma.marketingBanner.count({ where: { customerId: numericId } })
            .then(async (banners) => {
              const videos = this.prisma.marketingVideo?.count ? await this.prisma.marketingVideo.count({ where: { customerId: numericId } }) : 0;
              const trending = this.prisma.trendingContent?.count ? await this.prisma.trendingContent.count({ where: { customerId: numericId } }) : 0;
              return banners + videos + trending;
            })
            .catch(() => 0)
        : Promise.resolve(0),
      // Social Media
      this.prisma.socialPublish?.count
        ? this.prisma.socialPublish.count({ where: { customerId: numericId } })
            .then(async (publishes) => {
              const accounts = this.prisma.socialAccount?.count ? await this.prisma.socialAccount.count({ where: { customerId: numericId } }) : 0;
              return publishes + accounts;
            })
            .catch(() => 0)
        : Promise.resolve(0),
      // AI Studio
      this.prisma.aiGeneration?.count
        ? this.prisma.aiGeneration.count({ where: { customerId: numericId } }).catch(() => 0)
        : Promise.resolve(0),
      // Influencer Bookings
      this.prisma.influencerBooking?.count
        ? this.prisma.influencerBooking.count({ where: { customerId: numericId } }).catch(() => 0)
        : Promise.resolve(0),
      // Protected Master data
      this.prisma.employee.count({ where: { customerId: numericId } }),
      this.prisma.department.count({ where: { customerId: numericId } }),
      this.prisma.designation.count({ where: { customerId: numericId } }),
      this.prisma.user.count({ where: { customerId: numericId } }),
      this.prisma.customerSubscription.count({ where: { customerId: numericId } }),
    ]);

    const totalRecordsToReset =
      leadsCount +
      contactsCount +
      companiesCount +
      dealsCount +
      tasksCount +
      visitsCount +
      quotationsCount +
      invoicesCount +
      paymentsCount +
      installmentsCount +
      dataCapturePlacesCount +
      dataCaptureJobsCount +
      worksCount +
      monthlySchedulesCount +
      ticketsCount +
      notificationsCount +
      attendancesCount +
      breaksCount +
      leavesCount +
      remotesCount +
      locationsCount +
      payrollsCount +
      slipsCount +
      claimsCount +
      loansCount +
      marketingCount +
      socialCount +
      aiGenerationsCount +
      bookingsCount;

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        companyName: customer.companyName,
        displayName: customer.companyName || customer.name,
      },
      summary: {
        crm: {
          leads: leadsCount,
          contacts: contactsCount,
          companies: companiesCount,
          deals: dealsCount,
          tasks: tasksCount,
          visits: visitsCount,
          quotations: quotationsCount,
          total: leadsCount + contactsCount + companiesCount + dealsCount + tasksCount + visitsCount + quotationsCount,
        },
        billing: {
          invoices: invoicesCount,
          payments: paymentsCount,
          installments: installmentsCount,
          total: invoicesCount + paymentsCount + installmentsCount,
        },
        dataCapture: {
          places: dataCapturePlacesCount,
          jobs: dataCaptureJobsCount,
          total: dataCapturePlacesCount + dataCaptureJobsCount,
        },
        marketing: {
          campaigns: marketingCount,
          social: socialCount,
          total: marketingCount + socialCount,
        },
        aiStudio: {
          generations: aiGenerationsCount,
          total: aiGenerationsCount,
        },
        bookings: {
          influencerBookings: bookingsCount,
          total: bookingsCount,
        },
        operations: {
          works: worksCount,
          schedules: monthlySchedulesCount,
          tickets: ticketsCount,
          notifications: notificationsCount,
          attendances: attendancesCount,
          breaks: breaksCount,
          leaves: leavesCount,
          remotes: remotesCount,
          locations: locationsCount,
          payrolls: payrollsCount,
          salarySlips: slipsCount,
          claims: claimsCount,
          loans: loansCount,
          total:
            worksCount +
            monthlySchedulesCount +
            ticketsCount +
            notificationsCount +
            attendancesCount +
            breaksCount +
            leavesCount +
            remotesCount +
            locationsCount +
            payrollsCount +
            slipsCount +
            claimsCount +
            loansCount,
        },
        totalRecords: totalRecordsToReset,
      },
      masterDataPreserved: {
        employees: employeesCount,
        departments: departmentsCount,
        designations: designationsCount,
        users: usersCount,
        subscriptions: subscriptionsCount,
        accountRemains: true,
      },
    };
  }

  /**
   * Reset all customer business and transactional data within a Prisma transaction
   * - Scoped exclusively to the target customerId
   * - Enforces tenant isolation (Super Admin or authorized tenant admin)
   * - Requires typing exact customer name or company name for confirmation
   * - Preserves customer account, login accounts, and master configuration
   */
  async resetCustomerData(id: number | string, user?: any, dto?: ResetCustomerDataDto) {
    const numericId = this.parseCustomerId(id);
    const existing = await this.prisma.customer.findUnique({
      where: { id: numericId },
    });

    if (!existing) {
      throw new NotFoundException(`Customer #${id} not found.`);
    }

    // 1. Tenant Isolation & Authorization Check
    if (user && !isUserSuperAdmin(user)) {
      if (!isUserAdminOrStaff(user)) {
        throw new ForbiddenException('Only administrators can perform customer data resets.');
      }
      const callerCustomerId = Number(user.customerId);
      if (!callerCustomerId || callerCustomerId !== numericId) {
        throw new ForbiddenException('Cross-tenant data reset forbidden. You can only reset your own organization.');
      }
    }

    // 2. Strong Confirmation Check
    const confirmation = (dto?.confirmation || '').trim().toLowerCase();
    const primaryName = existing.name.trim().toLowerCase();
    const compName = (existing.companyName || '').trim().toLowerCase();
    const allowed = [primaryName, 'reset all data'];
    if (compName) allowed.push(compName);

    if (!allowed.includes(confirmation)) {
      const displayName = existing.companyName || existing.name;
      throw new BadRequestException(
        `Confirmation mismatch. You must type "${displayName}" to confirm customer data reset.`,
      );
    }

    // NOTE: preserveSubscriptions flag is intentionally ignored.
    // Subscription/plan state is ALWAYS fully reset — keeping subscriptions would
    // leave the customer appearing active in the Plans screen, Profile, and Admin panel.
    // The DTO field is retained for backward compatibility but has no effect.
    const preserveInvoices = dto?.preserveInvoices === true;

    // 3. Atomic Prisma Transaction with Foreign Key Order
    const resetResult = await this.prisma.$transaction(async (tx) => {
      const cnt = (res: any) => (res && typeof res.count === 'number' ? res.count : 0);

      // Step A: Dependent leaf child tables without direct customerId
      if (tx.leadActivityTimeline?.deleteMany) await tx.leadActivityTimeline.deleteMany({ where: { lead: { customerId: numericId } } });
      if (tx.leadNote?.deleteMany) await tx.leadNote.deleteMany({ where: { lead: { customerId: numericId } } });
      if (tx.leadReminder?.deleteMany) await tx.leadReminder.deleteMany({ where: { lead: { customerId: numericId } } });
      if (tx.leadStatusHistory?.deleteMany) await tx.leadStatusHistory.deleteMany({ where: { lead: { customerId: numericId } } });
      if (tx.communicationHistory?.deleteMany) await tx.communicationHistory.deleteMany({ where: { contact: { customerId: numericId } } });
      if (tx.taskReview?.deleteMany) await tx.taskReview.deleteMany({ where: { task: { customerId: numericId } } });
      if (tx.taskProof?.deleteMany) await tx.taskProof.deleteMany({ where: { task: { customerId: numericId } } });
      if (tx.taskHistory?.deleteMany) await tx.taskHistory.deleteMany({ where: { task: { customerId: numericId } } });
      if (tx.quotationItem?.deleteMany) await tx.quotationItem.deleteMany({ where: { quotation: { customerId: numericId } } });
      if (tx.workTask?.deleteMany) await tx.workTask.deleteMany({ where: { work: { customerId: numericId } } });
      if (tx.ticketComment?.deleteMany) await tx.ticketComment.deleteMany({ where: { ticket: { customerId: numericId } } });
      if (tx.attendanceBreak?.deleteMany) await tx.attendanceBreak.deleteMany({ where: { attendance: { customerId: numericId } } });
      if (tx.aiGenerationAsset?.deleteMany) await tx.aiGenerationAsset.deleteMany({ where: { generation: { customerId: numericId } } });

      // Step B: Marketing, Campaigns & Social Media
      const videoViews = tx.customerMarketingVideoView?.deleteMany ? await tx.customerMarketingVideoView.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const videos = tx.marketingVideo?.deleteMany ? await tx.marketingVideo.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const banners = tx.marketingBanner?.deleteMany ? await tx.marketingBanner.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const trending = tx.trendingContent?.deleteMany ? await tx.trendingContent.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const socialPublishes = tx.socialPublish?.deleteMany ? await tx.socialPublish.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const socialAccounts = tx.socialAccount?.deleteMany ? await tx.socialAccount.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const socialHandlers = tx.socialMediaHandler?.deleteMany ? await tx.socialMediaHandler.deleteMany({ where: { customerId: numericId } }) : { count: 0 };

      // Step C: AI Studio
      const aiGens = tx.aiGeneration?.deleteMany ? await tx.aiGeneration.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const aiTxns = tx.aiCreditTransaction?.deleteMany ? await tx.aiCreditTransaction.deleteMany({ where: { customerId: numericId } }) : { count: 0 };

      // Step D: Influencer Bookings & Reviews
      const bookingPayments = tx.influencerBookingPayment?.deleteMany ? await tx.influencerBookingPayment.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const reviews = tx.influencerReview?.deleteMany ? await tx.influencerReview.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const bookings = tx.influencerBooking?.deleteMany ? await tx.influencerBooking.deleteMany({ where: { customerId: numericId } }) : { count: 0 };

      // Step E: Calendar / Schedules, Works, Work Access & Limits
      const schedules = tx.monthlySchedule?.deleteMany ? await tx.monthlySchedule.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const workAccess = tx.workAccessRequest?.deleteMany ? await tx.workAccessRequest.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      if (tx.roleWorkPermission?.deleteMany) await tx.roleWorkPermission.deleteMany({ where: { customerId: numericId } });
      if (tx.employeeModuleOverride?.deleteMany) await tx.employeeModuleOverride.deleteMany({ where: { customerId: numericId } });
      if (tx.employeeLeadLimit?.deleteMany) await tx.employeeLeadLimit.deleteMany({ where: { customerId: numericId } });
      if (tx.roleLeadLimit?.deleteMany) await tx.roleLeadLimit.deleteMany({ where: { customerId: numericId } });
      const works = tx.work?.deleteMany ? await tx.work.deleteMany({ where: { customerId: numericId } }) : { count: 0 };

      // Step F: Billing items & invoices (if not preserved)
      let deletedInvoices = 0;
      let deletedPayments = 0;
      let deletedInstallments = 0;
      if (!preserveInvoices) {
        if (tx.invoiceItem?.deleteMany) await tx.invoiceItem.deleteMany({ where: { invoice: { customerId: numericId } } });
        const invRes = tx.invoice?.deleteMany ? await tx.invoice.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
        const payRes = tx.paymentHistory?.deleteMany ? await tx.paymentHistory.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
        const instRes = tx.subscriptionInstallment?.deleteMany ? await tx.subscriptionInstallment.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
        if (tx.customPlanOrder?.deleteMany) await tx.customPlanOrder.deleteMany({ where: { customerId: numericId } });
        deletedInvoices = cnt(invRes);
        deletedPayments = cnt(payRes);
        deletedInstallments = cnt(instRes);
      }

      // Step G: CRM parent tables
      const quotations = tx.quotation?.deleteMany ? await tx.quotation.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const visits = tx.visit?.deleteMany ? await tx.visit.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const tasks = tx.task?.deleteMany ? await tx.task.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const deals = tx.deal?.deleteMany ? await tx.deal.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const leads = tx.lead?.deleteMany ? await tx.lead.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const contacts = tx.contact?.deleteMany ? await tx.contact.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const companies = tx.company?.deleteMany ? await tx.company.deleteMany({ where: { customerId: numericId } }) : { count: 0 };

      // Step H: Data Capture
      const dcPlaces = tx.dataCapturePlace?.deleteMany ? await tx.dataCapturePlace.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const dcJobs = tx.dataCaptureJob?.deleteMany ? await tx.dataCaptureJob.deleteMany({ where: { customerId: numericId } }) : { count: 0 };

      // Step I: Operations & HR Transactional
      const tickets = tx.supportTicket?.deleteMany ? await tx.supportTicket.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const notifications = tx.notification?.deleteMany ? await tx.notification.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const locations = tx.employeeLocation?.deleteMany ? await tx.employeeLocation.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      if (tx.locationTrackingSetting?.deleteMany) await tx.locationTrackingSetting.deleteMany({ where: { customerId: numericId } });
      const attendances = tx.attendance?.deleteMany ? await tx.attendance.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const leaves = tx.leaveRequest?.deleteMany ? await tx.leaveRequest.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      if (tx.leaveAdjustmentHistory?.deleteMany) await tx.leaveAdjustmentHistory.deleteMany({ where: { customerId: numericId } });
      if (tx.employeeLeaveBalance?.deleteMany) await tx.employeeLeaveBalance.deleteMany({ where: { customerId: numericId } });
      const remotes = tx.remoteRequest?.deleteMany ? await tx.remoteRequest.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const slips = tx.salarySlip?.deleteMany ? await tx.salarySlip.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const payrollItems = tx.payrollItem?.deleteMany ? await tx.payrollItem.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const payrolls = tx.payroll?.deleteMany ? await tx.payroll.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const claims = tx.employeeClaim?.deleteMany ? await tx.employeeClaim.deleteMany({ where: { customerId: numericId } }) : { count: 0 };
      const loans = tx.employeeLoan?.deleteMany ? await tx.employeeLoan.deleteMany({ where: { customerId: numericId } }) : { count: 0 };

      // Step J: Subscription & Plan state — ALWAYS fully reset
      // Rationale: The purpose of "Reset Data" is to make the customer behave as
      // a fresh account. Leaving subscriptions/plan entitlements active contradicts
      // that goal and was the primary reported bug (subscription still showed after reset).
      //
      // FK ordering:
      //   MonthlySchedule  (subscriptionId FK) → already deleted in Step E
      //   Work             (subscriptionId FK) → already deleted in Step E
      //   SubscriptionInstallment (subscriptionId FK) → already deleted in Step F
      //   CustomPlanOrder  (subscriptionId FK) → already deleted in Step F
      //   PaymentHistory   (subscriptionId FK, onDelete: SetNull) → already deleted in Step F
      //   PlanEntitlement  (customerId FK)     → delete now (no sub FK)
      //   FeatureToggle    (customerId FK)     → delete now (plan-driven flags)
      //   AiCreditWallet   (customerId unique) → reset balance to 0 (preserve row for fresh start)
      //   CustomerSubscription → delete last

      // J-1: Plan quota entitlements (tracks slots used by subscription)
      const planEntitlements = tx.planEntitlement?.deleteMany
        ? await tx.planEntitlement.deleteMany({ where: { customerId: numericId } })
        : { count: 0 };

      // J-2: Feature toggles driven by plan (e.g. AI enabled, lead limits)
      if (tx.featureToggle?.deleteMany) {
        await tx.featureToggle.deleteMany({ where: { customerId: numericId } });
      }

      // J-3: AI credit wallet — reset balance to 0 (keep the row so wallet is re-created
      //       fresh on next plan activation; do NOT delete because it has @unique customerId)
      if (tx.aiCreditWallet?.updateMany) {
        await tx.aiCreditWallet.updateMany({
          where: { customerId: numericId },
          data: { balance: 0, totalEarned: 0, totalSpent: 0, updatedAt: new Date() },
        });
      }

      // J-4: Delete all customer subscription rows (children already cleaned above)
      const subscriptions = tx.customerSubscription?.deleteMany
        ? await tx.customerSubscription.deleteMany({ where: { customerId: numericId } })
        : { count: 0 };

      const totalDeleted =
        deletedInvoices +
        deletedPayments +
        deletedInstallments +
        cnt(quotations) +
        cnt(tasks) +
        cnt(deals) +
        cnt(visits) +
        cnt(leads) +
        cnt(contacts) +
        cnt(companies) +
        cnt(dcPlaces) +
        cnt(dcJobs) +
        cnt(works) +
        cnt(schedules) +
        cnt(tickets) +
        cnt(notifications) +
        cnt(locations) +
        cnt(attendances) +
        cnt(leaves) +
        cnt(remotes) +
        cnt(slips) +
        cnt(payrollItems) +
        cnt(payrolls) +
        cnt(claims) +
        cnt(loans) +
        cnt(videoViews) +
        cnt(videos) +
        cnt(banners) +
        cnt(trending) +
        cnt(socialPublishes) +
        cnt(socialAccounts) +
        cnt(socialHandlers) +
        cnt(aiGens) +
        cnt(aiTxns) +
        cnt(bookingPayments) +
        cnt(reviews) +
        cnt(bookings) +
        cnt(workAccess) +
        cnt(subscriptions) +
        cnt(planEntitlements);

      // Step K: Reset storage usage
      if (tx.customer?.update) {
        await tx.customer.update({
          where: { id: numericId },
          data: {
            storageUsed: 0,
            updatedAt: new Date(),
          },
        });
      }

      // Step L: Audit Log
      const auditDetails = {
        action: 'CUSTOMER_DATA_RESET',
        scope: 'CUSTOMER_SCOPED',
        customerId: numericId,
        customerName: existing.name,
        companyName: existing.companyName,
        performedBy: user?.email || user?.id || 'Admin',
        performedByRole: user?.role || 'SUPER_ADMIN',
        reason: dto?.reason || 'Customer-scoped data reset initiated by Admin',
        deletedCounts: {
          leads: cnt(leads),
          contacts: cnt(contacts),
          companies: cnt(companies),
          deals: cnt(deals),
          tasks: cnt(tasks),
          visits: cnt(visits),
          quotations: cnt(quotations),
          invoices: deletedInvoices,
          payments: deletedPayments,
          installments: deletedInstallments,
          dataCapturePlaces: cnt(dcPlaces),
          dataCaptureJobs: cnt(dcJobs),
          works: cnt(works),
          schedules: cnt(schedules),
          tickets: cnt(tickets),
          notifications: cnt(notifications),
          attendances: cnt(attendances),
          leaves: cnt(leaves),
          remotes: cnt(remotes),
          locations: cnt(locations),
          payrolls: cnt(payrolls),
          claims: cnt(claims),
          loans: cnt(loans),
          marketing: cnt(banners) + cnt(videos) + cnt(trending),
          social: cnt(socialPublishes) + cnt(socialAccounts),
          aiGenerations: cnt(aiGens),
          bookings: cnt(bookings),
          subscriptions: cnt(subscriptions),
          planEntitlements: cnt(planEntitlements),
          aiCreditWalletReset: true,
          featureTogglesCleared: true,
        },
        totalDeleted,
        timestamp: new Date().toISOString(),
        status: 'SUCCESS',
      };

      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            customerId: numericId,
            userId: user?.id && !isNaN(Number(user.id)) ? Number(user.id) : null,
            action: 'CUSTOMER_DATA_RESET',
            module: 'CUSTOMER_MANAGEMENT',
            details: auditDetails,
          },
        });
      }

      // Step M: Verification before committing transaction
      if (typeof (tx.lead as any)?.count === 'function') {
        const remaining = await Promise.all([
          tx.lead.count({ where: { customerId: numericId } }),
          tx.contact?.count ? tx.contact.count({ where: { customerId: numericId } }) : 0,
          tx.company?.count ? tx.company.count({ where: { customerId: numericId } }) : 0,
          tx.deal?.count ? tx.deal.count({ where: { customerId: numericId } }) : 0,
          tx.task?.count ? tx.task.count({ where: { customerId: numericId } }) : 0,
          tx.visit?.count ? tx.visit.count({ where: { customerId: numericId } }) : 0,
          tx.quotation?.count ? tx.quotation.count({ where: { customerId: numericId } }) : 0,
          tx.dataCaptureJob?.count ? tx.dataCaptureJob.count({ where: { customerId: numericId } }) : 0,
          tx.dataCapturePlace?.count ? tx.dataCapturePlace.count({ where: { customerId: numericId } }) : 0,
          tx.work?.count ? tx.work.count({ where: { customerId: numericId } }) : 0,
          tx.monthlySchedule?.count ? tx.monthlySchedule.count({ where: { customerId: numericId } }) : 0,
          tx.supportTicket?.count ? tx.supportTicket.count({ where: { customerId: numericId } }) : 0,
          tx.notification?.count ? tx.notification.count({ where: { customerId: numericId } }) : 0,
          tx.attendance?.count ? tx.attendance.count({ where: { customerId: numericId } }) : 0,
          tx.leaveRequest?.count ? tx.leaveRequest.count({ where: { customerId: numericId } }) : 0,
          tx.remoteRequest?.count ? tx.remoteRequest.count({ where: { customerId: numericId } }) : 0,
          tx.employeeLocation?.count ? tx.employeeLocation.count({ where: { customerId: numericId } }) : 0,
          tx.payroll?.count ? tx.payroll.count({ where: { customerId: numericId } }) : 0,
          tx.employeeClaim?.count ? tx.employeeClaim.count({ where: { customerId: numericId } }) : 0,
          tx.employeeLoan?.count ? tx.employeeLoan.count({ where: { customerId: numericId } }) : 0,
        ]);

        if (remaining.some((count) => count !== 0)) {
          throw new InternalServerErrorException(
            'Customer reset verification failed; transaction was rolled back.',
          );
        }
      }

      return auditDetails;
    });

    this.logger.log(
      `[CUSTOMER_DATA_RESET] Successfully reset data for Customer #${numericId} (${existing.name}). Total deleted records: ${resetResult.totalDeleted}. Customer account preserved.`,
    );

    return {
      success: true,
      message: `Customer data for "${existing.companyName || existing.name}" has been successfully reset. All ${resetResult.totalDeleted} business records were deleted. Customer account and master records remain intact.`,
      data: {
        customerId: existing.id,
        activeSubscription: null,       // Always null after reset — subscriptions fully removed
        currentPlan: null,
        subscriptionsDeleted: resetResult.deletedCounts?.subscriptions ?? 0,
        planEntitlementsCleared: resetResult.deletedCounts?.planEntitlements ?? 0,
        aiWalletReset: resetResult.deletedCounts?.aiCreditWalletReset ?? false,
      },
      deletedCounts: resetResult.deletedCounts,
      totalDeleted: resetResult.totalDeleted,
      customer: {
        id: existing.id,
        name: existing.name,
        companyName: existing.companyName,
        isActive: existing.isActive,
      },
    };
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
              take: 5,
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
          take: 5,
          include: { plan: true },
        },
      },
    }));

    if (!customer || customer.deletedAt) {
      throw new NotFoundException('Customer profile not found');
    }

    const activeSub =
      customer.subscriptions.find((s) => s.status === 'ACTIVE' && (!s.endDate || new Date(s.endDate) >= new Date())) ||
      customer.subscriptions.find((s) => s.status === 'ACTIVE') ||
      customer.subscriptions[0];
    const qbCode = this.qbIdGenerator.generateQBUserId('CUSTOMER', customer.id);
    const customerCode = `CUST-${String(customer.id).padStart(4, '0')}`;

    // Cleanly separate person name from business/company name
    const rawCompany = (customer.companyName || '').trim();
    const rawCustName = (customer.name || '').trim();
    const resolvedBusiness = rawCompany || (rawCustName.toLowerCase() !== (userRecord.firstName || '').toLowerCase() ? rawCustName : '') || 'Customer Workspace';

    let pFirst = (userRecord.firstName || '').trim();
    let pMiddle = ((userRecord as any).middleName || '').trim();
    let pLast = (userRecord.lastName || '').trim();

    // Prevent accidental company name bleed into user lastName
    const compLower = (rawCompany || resolvedBusiness).toLowerCase().trim();
    if (compLower.length > 0) {
      if (pLast.toLowerCase() === compLower || (compLower.length >= 3 && pLast.toLowerCase().endsWith(compLower))) {
        pLast = '';
      }
    }

    // If customer.name contains the customer's actual full name entered in Admin Panel
    // (e.g. "Avinash Sanjay Magar" vs Company "QuikBoom Digital Marketing")
    if (rawCustName && rawCustName.toLowerCase() !== resolvedBusiness.toLowerCase()) {
      const parts = rawCustName.split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        if (!pFirst) pFirst = parts[0];
      } else if (parts.length === 2) {
        if (!pFirst) pFirst = parts[0];
        if (!pLast) pLast = parts[1];
      } else if (parts.length >= 3) {
        if (!pFirst) pFirst = parts[0];
        if (!pMiddle) pMiddle = parts.slice(1, -1).join(' ');
        if (!pLast) pLast = parts[parts.length - 1];
      }
    }

    const pFullName = [pFirst, pMiddle, pLast].filter(Boolean).join(' ').trim() ||
      (rawCustName.toLowerCase() !== resolvedBusiness.toLowerCase() ? rawCustName : pFirst) ||
      'Customer';

    const safeCustomer = this.serializeBigInt(customer);

    return {
      success: true,
      data: {
        id: customer.id,
        customerId: customerCode,
        customerCode: customerCode,
        qbCustomerId: qbCode,
        name: rawCustName,
        firstName: pFirst,
        middleName: pMiddle || null,
        lastName: pLast,
        fullName: pFullName,
        contactFirstName: pFirst,
        contactMiddleName: pMiddle || null,
        contactLastName: pLast,
        contactFullName: pFullName,
        companyName: resolvedBusiness,
        businessName: resolvedBusiness,
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
          firstName: pFirst || userRecord.firstName,
          middleName: pMiddle || (userRecord as any).middleName || null,
          lastName: pLast,
          fullName: pFullName,
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
