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
import { Prisma, RoleType, CommissionStatus } from '@prisma/client';
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
  type: 'Final Call' | 'Next Call' | 'Follow-up';
  callType: 'FINAL_CALL' | 'NEXT_CALL' | 'FOLLOW_UP';
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

export function extractUpcomingCall(
  c: any,
  now: Date = new Date(),
  finalCallStageIds?: Set<number>,
  followUpStageIds?: Set<number>,
): UpcomingCallInfo | null {
  const linkedLeads = [
    ...((c as any).originLead ? [(c as any).originLead] : []),
    ...((c as any).leads || []),
  ].filter((l: any) => l && !l.deletedAt);

  const candidates: Array<{
    type: 'Final Call' | 'Next Call' | 'Follow-up';
    callType: 'FINAL_CALL' | 'NEXT_CALL' | 'FOLLOW_UP';
    scheduledAt: Date;
    originalTime?: string | null;
    notes?: string;
  }> = [];

  for (const l of linkedLeads) {
    const st = String(l.status || '').toUpperCase();
    const stageKey = String(l.stage?.key || '').toUpperCase();
    const stageName = String(l.stage?.name || '').toLowerCase();

    // Check if the lead is terminal LOST or CANCELLED without reminders/calls
    const isLeadLostOrCancelled =
      ['LOST', 'CANCELLED'].includes(st) ||
      ['LOST', 'CANCELLED'].includes(stageKey) ||
      ['lost', 'cancelled'].includes(stageName);

    // Check if lead has reached WON or has been converted to customer
    const isLeadWon =
      ['WON', 'CONVERTED'].includes(st) ||
      ['WON', 'CONVERTED'].includes(stageKey) ||
      stageName.includes('won') ||
      stageName.includes('converted') ||
      Boolean(l.convertedAt) ||
      Boolean(l.convertedCustomer);

    // Final Call stage detection using configured key, stageId, status enum, or fallback name
    const isFinalCallStage =
      st === 'FINAL_CALL' ||
      stageKey === 'FINAL_CALL' ||
      (l.stageId && finalCallStageIds?.has(Number(l.stageId))) ||
      (l.stage?.id && finalCallStageIds?.has(Number(l.stage.id))) ||
      stageName.includes('final') ||
      l.isFinalCall === true ||
      String(l.callType || '').toUpperCase() === 'FINAL_CALL';

    // Follow-up stage detection using configured key, stageId, status enum, or fallback name
    const isFollowUpStage =
      st === 'FOLLOW_UP' ||
      st === 'FOLLOWUP' ||
      stageKey === 'FOLLOW_UP' ||
      stageKey === 'FOLLOWUP' ||
      (l.stageId && followUpStageIds?.has(Number(l.stageId))) ||
      (l.stage?.id && followUpStageIds?.has(Number(l.stage.id))) ||
      stageName.includes('follow');

    // Call completion and cancellation flags
    const isFinalCallCompleted =
      l.isFinalCallCompleted === true ||
      l.finalCallCompleted === true ||
      ['COMPLETED', 'DONE'].includes(String(l.finalCallStatus || '').toUpperCase());

    const isFinalCallCancelled =
      l.isFinalCallCancelled === true ||
      ['CANCELLED'].includes(String(l.finalCallStatus || '').toUpperCase());

    const isLeadCallCompleted =
      l.isCompleted === true ||
      l.isCallCompleted === true ||
      ['COMPLETED', 'DONE'].includes(String(l.callStatus || '').toUpperCase());

    const isLeadCallCancelled =
      l.isCancelled === true ||
      ['CANCELLED'].includes(String(l.callStatus || '').toUpperCase()) ||
      st === 'CANCELLED';

    // 1. Follow-up / Final call scheduled via nextFollowUpDate
    if (l.nextFollowUpDate && !isLeadLostOrCancelled) {
      const scheduledAt = parseCallDateTime(l.nextFollowUpDate, l.nextFollowUpTime);

      // Only scheduled calls strictly in the future are upcoming candidates (overdue calls are excluded)
      if (scheduledAt > now) {
        const isDateCompletedFinalCall =
          (isFinalCallCompleted || isFinalCallCancelled) &&
          (!l.finalCallDate || new Date(l.nextFollowUpDate).getTime() <= new Date(l.finalCallDate).getTime());

        if (isFinalCallStage) {
          if (!isFinalCallCompleted && !isFinalCallCancelled && !isLeadCallCompleted && !isLeadCallCancelled) {
            candidates.push({
              type: 'Final Call',
              callType: 'FINAL_CALL',
              scheduledAt,
              originalTime: l.nextFollowUpTime || '11:00 AM',
              notes: l.workNotes || undefined,
            });
          }
        } else if (!isDateCompletedFinalCall && !isLeadCallCompleted && !isLeadCallCancelled && !isLeadWon) {
          const callTypeTitle = (isFinalCallCompleted || isFinalCallCancelled)
            ? 'Next Call'
            : isFollowUpStage
            ? 'Follow-up'
            : 'Next Call';
          const callTypeEnum = (isFinalCallCompleted || isFinalCallCancelled)
            ? 'NEXT_CALL'
            : isFollowUpStage
            ? 'FOLLOW_UP'
            : 'NEXT_CALL';

          candidates.push({
            type: callTypeTitle,
            callType: callTypeEnum,
            scheduledAt,
            originalTime: l.nextFollowUpTime || '11:00 AM',
            notes: l.workNotes || undefined,
          });
        }
      }
    }

    // 1b. Check explicit nextCallDate if provided separately
    if (l.nextCallDate && !isLeadLostOrCancelled) {
      const nextCallAt = parseCallDateTime(l.nextCallDate, l.nextCallTime);
      const isDateCompletedFinalCall =
        (isFinalCallCompleted || isFinalCallCancelled) &&
        (!l.finalCallDate || new Date(l.nextCallDate).getTime() <= new Date(l.finalCallDate).getTime());

      if (nextCallAt > now && !isDateCompletedFinalCall && !isLeadCallCompleted && !isLeadCallCancelled && !isLeadWon) {
        const callTypeTitle = (isFinalCallCompleted || isFinalCallCancelled)
          ? 'Next Call'
          : isFollowUpStage
          ? 'Follow-up'
          : 'Next Call';
        const callTypeEnum = (isFinalCallCompleted || isFinalCallCancelled)
          ? 'NEXT_CALL'
          : isFollowUpStage
          ? 'FOLLOW_UP'
          : 'NEXT_CALL';

        candidates.push({
          type: callTypeTitle,
          callType: callTypeEnum,
          scheduledAt: nextCallAt,
          originalTime: l.nextCallTime || null,
          notes: l.workNotes || undefined,
        });
      }
    }

    const isCallCompleted =
      isFinalCallCompleted ||
      l.isCompleted === true ||
      l.isCallCompleted === true ||
      ['COMPLETED', 'DONE'].includes(String(l.callStatus || '').toUpperCase());

    const isCallCancelled =
      isFinalCallCancelled ||
      l.isCancelled === true ||
      ['CANCELLED'].includes(String(l.callStatus || '').toUpperCase()) ||
      st === 'CANCELLED';

    const explicitDate = l.nextFollowUpDate || l.nextCallDate;
    const isExplicitlyOverdue = explicitDate && parseCallDateTime(explicitDate, l.nextFollowUpTime || l.nextCallTime) < now;

    // 1c. Lead in Final Call stage automatically qualifies as an Upcoming prospect
    // If an explicit follow-up date was set in the past, it is overdue rather than upcoming.
    if (
      isFinalCallStage &&
      !isCallCompleted &&
      !isCallCancelled &&
      !isLeadLostOrCancelled &&
      !isLeadWon &&
      !isExplicitlyOverdue
    ) {
      const alreadyHasFinalCall = candidates.some((c) => c.callType === 'FINAL_CALL');
      if (!alreadyHasFinalCall) {
        // Use the scheduled date for sorting; fall back to now
        const scheduledAt = explicitDate
          ? parseCallDateTime(explicitDate, l.nextFollowUpTime || l.nextCallTime)
          : now;
        candidates.push({
          type: 'Final Call',
          callType: 'FINAL_CALL',
          scheduledAt,
          originalTime: l.nextFollowUpTime || l.nextCallTime || (explicitDate ? null : '11:00 AM'),
          notes: l.workNotes || 'Lead reached Final Call stage',
        });
      }
    }

    // 1d. Lead in Follow-up stage automatically qualifies as an Upcoming prospect
    // If an explicit follow-up date was set in the past, it is overdue rather than upcoming.
    if (
      isFollowUpStage &&
      !isCallCompleted &&
      !isCallCancelled &&
      !isLeadLostOrCancelled &&
      !isLeadWon &&
      !isExplicitlyOverdue
    ) {
      const alreadyHasFollowUp = candidates.some((c) => c.callType === 'FOLLOW_UP');
      if (!alreadyHasFollowUp) {
        // Use the scheduled date for sorting; fall back to now
        const scheduledAt = explicitDate
          ? parseCallDateTime(explicitDate, l.nextFollowUpTime || l.nextCallTime)
          : now;
        candidates.push({
          type: 'Follow-up',
          callType: 'FOLLOW_UP',
          scheduledAt,
          originalTime: l.nextFollowUpTime || l.nextCallTime || (explicitDate ? null : '11:00 AM'),
          notes: l.workNotes || 'Lead in Follow-up stage',
        });
      }
    }

    // 2. Active uncompleted reminders on the lead
    if (Array.isArray(l.reminders)) {
      for (const r of l.reminders) {
        const rCompleted = r.isCompleted === true || ['COMPLETED', 'DONE'].includes(String(r.status || '').toUpperCase());
        const rCancelled = r.isCancelled === true || String(r.status || '').toUpperCase() === 'CANCELLED';
        if (!rCompleted && !rCancelled && r.remindAt) {
          const remDate = new Date(r.remindAt);
          if (!isNaN(remDate.getTime()) && remDate > now) {
            const rTitle = String(r.title || '').toLowerCase();
            const rIsFinal = isFinalCallStage || rTitle.includes('final');
            const rIsFollow = isFollowUpStage || rTitle.includes('follow');
            candidates.push({
              type: rIsFinal ? 'Final Call' : rIsFollow ? 'Follow-up' : 'Next Call',
              callType: rIsFinal ? 'FINAL_CALL' : rIsFollow ? 'FOLLOW_UP' : 'NEXT_CALL',
              scheduledAt: remDate,
              originalTime: null,
              notes: r.title,
            });
          }
        }
      }
    }

    // 3. Explicit scheduled calls on the lead (e.g. calls array)
    if (Array.isArray((l as any).calls)) {
      for (const call of (l as any).calls) {
        const cCompleted = call.isCompleted === true || ['COMPLETED', 'DONE'].includes(String(call.status || '').toUpperCase());
        const cCancelled = call.isCancelled === true || String(call.status || '').toUpperCase() === 'CANCELLED';
        if (!cCompleted && !cCancelled) {
          const callDate = call.scheduledAt ? new Date(call.scheduledAt) : (call.date ? parseCallDateTime(call.date, call.time) : null);
          if (callDate && !isNaN(callDate.getTime()) && callDate > now) {
            const callTitle = String(call.title || call.type || '').toLowerCase();
            const isCallFinal = isFinalCallStage || callTitle.includes('final');
            const isCallFollow = isFollowUpStage || callTitle.includes('follow');
            candidates.push({
              type: isCallFinal ? 'Final Call' : isCallFollow ? 'Follow-up' : 'Next Call',
              callType: isCallFinal ? 'FINAL_CALL' : isCallFollow ? 'FOLLOW_UP' : 'NEXT_CALL',
              scheduledAt: callDate,
              originalTime: call.time || null,
              notes: call.notes || call.title,
            });
          }
        }
      }
    }
  }

  // 4. Customer-level direct reminders/calls if any
  if (Array.isArray((c as any).reminders)) {
    for (const r of (c as any).reminders) {
      const rCompleted = r.isCompleted === true || ['COMPLETED', 'DONE'].includes(String(r.status || '').toUpperCase());
      const rCancelled = r.isCancelled === true || String(r.status || '').toUpperCase() === 'CANCELLED';
      if (!rCompleted && !rCancelled && r.remindAt) {
        const remDate = new Date(r.remindAt);
        if (!isNaN(remDate.getTime()) && remDate > now) {
          const rTitle = String(r.title || '').toLowerCase();
          const rIsFinal = rTitle.includes('final');
          const rIsFollow = rTitle.includes('follow');
          candidates.push({
            type: rIsFinal ? 'Final Call' : rIsFollow ? 'Follow-up' : 'Next Call',
            callType: rIsFinal ? 'FINAL_CALL' : rIsFollow ? 'FOLLOW_UP' : 'NEXT_CALL',
            scheduledAt: remDate,
            originalTime: null,
            notes: r.title,
          });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Sort strictly by scheduledAt ascending: earliest / nearest future call first
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
   * Maps an unconverted CRM Lead to the unified Customer Card format for Upcoming / All tabs
   */
  public mapLeadToCustomerItem(l: any, upcomingCall: UpcomingCallInfo | null): any {
    const contactName = `${l.firstName || ''} ${l.lastName || ''}`.trim();
    const companyName = (l.companyName || '').trim();
    const businessName = companyName.length > 0 ? companyName : (contactName.length > 0 ? contactName : `Lead #${l.id}`);
    const resolvedCustomerName = contactName.length > 0 ? contactName : (l.title || businessName);
    const resolvedCompanyName = companyName.length > 0 ? companyName : businessName;

    const stageName = l.stage?.name || (l.status === 'NEW' ? 'New' : l.status);
    const stageColor = l.stage?.color || (l.status === 'WON' ? '#10B981' : '#6366F1');
    const stageId = l.stage?.id || l.stageId || null;
    const stageKey = l.stage?.key || l.status;
    const stageNameLower = (stageName || '').toLowerCase();
    const resolvedAssignedName = l.employee
      ? `${l.employee.firstName || ''} ${l.employee.lastName || ''}`.trim()
      : (l.assignedTo?.firstName ? `${l.assignedTo.firstName} ${l.assignedTo.lastName || ''}`.trim() : 'Assigned');

    const isFinalCallStage =
      l.status === 'FINAL_CALL' ||
      stageKey === 'FINAL_CALL' ||
      stageNameLower.includes('final') ||
      upcomingCall?.callType === 'FINAL_CALL';

    const isFollowUpStage =
      l.status === 'FOLLOW_UP' ||
      l.status === 'FOLLOWUP' ||
      stageKey === 'FOLLOW_UP' ||
      stageKey === 'FOLLOWUP' ||
      stageNameLower.includes('follow') ||
      upcomingCall?.callType === 'FOLLOW_UP';

    const hasExplicitCallDate = Boolean(
      l.nextFollowUpDate ||
      l.nextCallDate ||
      (upcomingCall && upcomingCall.notes !== 'Lead in Follow-up stage' && upcomingCall.notes !== 'Lead reached Final Call stage')
    );

    const resolvedCallType =
      upcomingCall?.type ||
      (isFinalCallStage ? 'Final Call' : isFollowUpStage ? 'Follow-up' : null);

    const resolvedCallDate = l.nextFollowUpDate
      ? formatCallDate(parseCallDateTime(l.nextFollowUpDate, l.nextFollowUpTime))
      : l.nextCallDate
      ? formatCallDate(parseCallDateTime(l.nextCallDate, l.nextCallTime))
      : hasExplicitCallDate
      ? upcomingCall?.formattedDate || null
      : null;

    const resolvedCallTime = l.nextFollowUpDate
      ? formatCallTime(parseCallDateTime(l.nextFollowUpDate, l.nextFollowUpTime), l.nextFollowUpTime)
      : l.nextCallDate
      ? formatCallTime(parseCallDateTime(l.nextCallDate, l.nextCallTime), l.nextCallTime)
      : hasExplicitCallDate
      ? upcomingCall?.formattedTime || null
      : null;

    return {
      id: -(l.id),
      customerId: `LEAD-${String(l.id).padStart(4, '0')}`,
      name: businessName,
      customerName: resolvedCustomerName,
      companyName: resolvedCompanyName,
      company: resolvedCompanyName,
      workspaceName: resolvedCompanyName,
      contactFirstName: l.firstName || '',
      contactLastName: l.lastName || '',
      contactFullName: contactName || resolvedCustomerName,
      contactPerson: contactName || resolvedCustomerName,
      domain: l.website || (l.email ? l.email.split('@')[1] : null) || 'N/A',
      email: l.email || 'N/A',
      phone: l.phone || 'N/A',
      alternatePhone: null,
      address: l.address,
      city: l.city || 'N/A',
      state: l.state || 'N/A',
      country: l.country || 'India',
      pincode: null,
      customerType: 'LEAD',
      industry: l.category || 'General',
      source: l.source || 'LEAD',
      teamId: null,
      team: null,
      assignedEmployeeId: l.employeeId,
      assignedEmployee: resolvedAssignedName,
      department: 'Sales',
      notes: l.workNotes,
      isActive: false,
      status: upcomingCall ? 'UPCOMING' : 'INACTIVE',
      customerStatus: upcomingCall ? 'UPCOMING' : 'INACTIVE',
      upcomingCall: upcomingCall || null,
      hasUpcomingCall: upcomingCall !== null,
      upcomingCallType: resolvedCallType,
      upcomingCallDate: resolvedCallDate,
      upcomingCallTime: resolvedCallTime,
      leadId: String(l.id),
      leadStatus: l.status,
      leadStageId: stageId,
      leadStageName: stageName,
      leadStageColor: stageColor,
      lead: {
        id: l.id,
        status: l.status,
        stageId: stageId,
        stage: l.stage
          ? {
              id: l.stage.id,
              name: l.stage.name,
              color: l.stage.color,
              key: l.stage.key,
            }
          : {
              id: stageId,
              name: stageName,
              color: stageColor,
            },
      },
      plan: 'No Active Plan',
      planName: 'No Active Plan',
      planCode: 'NONE',
      billingCycle: 'MONTHLY',
      subscriptionStatus: 'NO_PLAN',
      subscriptionStartDate: null,
      subscriptionEndDate: null,
      subscriptionAmount: 0,
      baseAmount: 0,
      gstAmount: 0,
      users: 1,
      leads: 1,
      deals: 0,
      contacts: 1,
      tasks: 0,
      storageUsed: 0,
      storage: '0 MB',
      mrr: 0,
      aiCredits: 0,
      aiWallet: { balance: 0, totalEarned: 0, totalSpent: 0 },
      commission: null,
      upcomingCommission: null,
      lastActivity: l.updatedAt || l.createdAt,
      createdAt: l.createdAt,
    };
  }

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
        customerName: contactPerson || c.name || 'Primary Contact',
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
    stage?: string;
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

    let effectiveEmployeeId = employeeId;
    if (!effectiveEmployeeId && user?.id && !isPrivilegedAdmin) {
      const emp = await this.prisma.employee.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });
      if (emp) {
        effectiveEmployeeId = emp.id;
      }
    }

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

    // Strict Employee Scoping & Tenant Isolation (Requirements 1, 3, 4, 7, 8)
    // The Customer screen is employee-specific. The authenticated employee should see only customers they are authorized to see:
    // 1. customer.assignedEmployeeId == loggedInEmployeeId
    // 2. Or linked originLead / leads assigned to that employee (assignedToId == userId OR employeeId == loggedInEmployeeId)
    // Exclude unassigned, other employee's customers, and do NOT use createdById as replacement for assignedToId!
    if (effectiveEmployeeId && !isPrivilegedAdmin) {
      andConditions.push({
        OR: [
          // 1. Directly assigned to this employee
          { assignedEmployeeId: effectiveEmployeeId },
          // 2. Created by this employee
          { createdByEmployeeId: effectiveEmployeeId },
          // 3. Won by this employee via originLead
          {
            originLead: {
              deletedAt: null,
              convertedByEmployeeId: effectiveEmployeeId,
            },
          },
          // 4. Linked leads where originLead has no separate convertedByEmployeeId but is assigned to this employee
          {
            originLead: {
              deletedAt: null,
              convertedByEmployeeId: null,
              OR: [
                { employeeId: effectiveEmployeeId },
                ...(user?.id ? [{ assignedToId: user.id }] : []),
              ],
            },
          },
          // 5. Customer with no originLead, but leads assigned to this employee (excluding the root tenant workspace)
          {
            leadId: null,
            ...(companyId ? { id: { not: Number(companyId) } } : {}),
            leads: {
              some: {
                deletedAt: null,
                OR: [
                  { employeeId: effectiveEmployeeId },
                  ...(user?.id ? [{ assignedToId: user.id }] : []),
                ],
              },
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

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Resolve configured Upcoming (Final Call & Follow Up) stage IDs from LeadStage table
    let finalCallStageIds: Set<number> | undefined;
    let followUpStageIds: Set<number> | undefined;
    let wonStageIds: Set<number> | undefined;
    try {
      if (this.prisma.leadStage && typeof this.prisma.leadStage.findMany === 'function') {
        const upcomingStages = await this.prisma.leadStage.findMany({
          where: {
            OR: [
              { key: { in: ['FINAL_CALL', 'FOLLOW_UP', 'FOLLOWUP', 'WON', 'CONVERTED'] } },
              { name: { contains: 'final', mode: 'insensitive' } },
              { name: { contains: 'follow', mode: 'insensitive' } },
              { name: { contains: 'won', mode: 'insensitive' } },
              { name: { contains: 'converted', mode: 'insensitive' } },
            ],
            deletedAt: null,
          },
          select: { id: true, key: true, name: true },
        });
        if (upcomingStages.length > 0) {
          finalCallStageIds = new Set(
            upcomingStages
              .filter((s: any) => s.key === 'FINAL_CALL' || s.name?.toLowerCase().includes('final'))
              .map((s: any) => s.id),
          );
          followUpStageIds = new Set(
            upcomingStages
              .filter((s: any) => ['FOLLOW_UP', 'FOLLOWUP'].includes(s.key) || s.name?.toLowerCase().includes('follow'))
              .map((s: any) => s.id),
          );
          wonStageIds = new Set(
            upcomingStages
              .filter((s: any) => ['WON', 'CONVERTED'].includes(s.key) || s.name?.toLowerCase().includes('won') || s.name?.toLowerCase().includes('converted'))
              .map((s: any) => s.id),
          );
        }
      }
    } catch (err) {
      this.logger.debug(`Could not query leadStage for upcoming stageIds: ${err}`);
    }

    const countsWhere: any = {
      deletedAt: null,
      ...(shouldExcludeAdmins ? { NOT: SYSTEM_CUSTOMER_EXCLUSIONS } : {}),
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
      ...(where.createdAt ? { createdAt: where.createdAt } : {}),
      ...(where.source ? { source: where.source } : {}),
      ...(where.assignedTeamId ? { assignedTeamId: where.assignedTeamId } : {}),
    };

    // Calculate dynamic counts and matching ID sets across customers for [ All ] [ Active ] [ Upcoming ] [ Inactive ] tabs
    const allCustomersForCounts = await this.prisma.customer.findMany({
      where: countsWhere,
      select: {
        id: true,
        isActive: true,
        subscriptions: {
          where: { deletedAt: null },
          select: {
            status: true,
            endDate: true,
            planId: true,
            plan: { select: { id: true, name: true, code: true } },
          },
          orderBy: { createdAt: 'desc' },
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
            stage: { select: { id: true, name: true, key: true, color: true } },
            reminders: {
              where: { isCompleted: false },
              select: { id: true, remindAt: true, isCompleted: true, title: true },
            },
          },
        },
        originLead: {
          select: {
            id: true,
            status: true,
            nextFollowUpDate: true,
            nextFollowUpTime: true,
            stage: { select: { id: true, name: true, key: true, color: true } },
            reminders: {
              where: { isCompleted: false },
              select: { id: true, remindAt: true, isCompleted: true, title: true },
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
    const upcomingCustomerIds: number[] = [];
    const activeCustomerIds: number[] = [];
    const inactiveCustomerIds: number[] = [];
    const completedCustomerIds: number[] = [];

    for (const c of allCustomersForCounts) {
      // Priority 1: ACTIVE (valid, actually activated purchased plan)
      const activeSub = c.subscriptions?.find(
        (s: any) => s.status === 'ACTIVE' && (!s.endDate || new Date(s.endDate) >= now),
      );
      const isSubActive = !!activeSub;

      if (isSubActive) {
        activeCount++;
        activeCustomerIds.push(c.id);
      } else {
        // Priority 2: UPCOMING (eligible follow-up / final call and no active plan)
        const call = extractUpcomingCall(c, now, finalCallStageIds, followUpStageIds);
        if (call !== null) {
          upcomingCount++;
          upcomingCustomerIds.push(c.id);
        } else {
          // Priority 3: INACTIVE (no active plan and not eligible for upcoming)
          inactiveCount++;
          inactiveCustomerIds.push(c.id);
        }
      }

      const st = this.computeCustomerStatus(c, finalCallStageIds, followUpStageIds);
      if (st === 'INACTIVE' || st === 'ACTIVE') {
        completedCount++;
        completedCustomerIds.push(c.id);
      }
    }

    // Query unconverted Leads accessible to the employee/tenant
    const unconvertedUpcomingLeads: any[] = [];
    const unconvertedInactiveLeads: any[] = [];
    const unconvertedActiveLeads: any[] = [];
    const unconvertedAllLeads: any[] = [];

    if (this.prisma.lead) {
      try {
        const leadWhere: any = {
          deletedAt: null,
        };

        if (companyId) {
          leadWhere.customerId = companyId;
        }

        const leadAndConditions: any[] = [];
        const currentUserId = user?.id || user?.employee?.userId || user?.sub;

        if (effectiveEmployeeId && !isPrivilegedAdmin) {
          const empOrClauses: any[] = [{ employeeId: effectiveEmployeeId }];
          if (currentUserId) {
            empOrClauses.push({ assignedToId: currentUserId });
          }
          // Strict: DO NOT include createdById as replacement for assignedToId!
          leadAndConditions.push({ OR: empOrClauses });
        }

        if (query.search && query.search.trim()) {
          const s = query.search.trim();
          leadAndConditions.push({
            OR: [
              { firstName: { contains: s, mode: 'insensitive' } },
              { lastName: { contains: s, mode: 'insensitive' } },
              { companyName: { contains: s, mode: 'insensitive' } },
              { phone: { contains: s, mode: 'insensitive' } },
              { email: { contains: s, mode: 'insensitive' } },
              { city: { contains: s, mode: 'insensitive' } },
            ],
          });
        }

        if (query.stage && query.stage.trim() && query.stage.trim().toUpperCase() !== 'ALL') {
          const targetStage = query.stage.trim().toUpperCase();
          const isTargetFollowUp = targetStage === 'FOLLOW_UP' || targetStage === 'FOLLOWUP';
          const isTargetFinalCall = targetStage === 'FINAL_CALL';
          const matchingStageIds = isTargetFollowUp
            ? Array.from(followUpStageIds || [])
            : isTargetFinalCall
            ? Array.from(finalCallStageIds || [])
            : [];

          const stageConditions: any[] = [];
          if (matchingStageIds.length > 0) {
            stageConditions.push({ stageId: { in: matchingStageIds } });
          }
          if (['FOLLOW_UP', 'FINAL_CALL', 'NEW', 'WON', 'LOST'].includes(targetStage)) {
            stageConditions.push({ status: targetStage });
          }
          stageConditions.push({
            stage: {
              OR: [
                { key: { equals: targetStage, mode: 'insensitive' } },
                { name: { contains: query.stage.trim(), mode: 'insensitive' } },
              ],
            },
          });
          leadAndConditions.push({ OR: stageConditions });
        }

        if (leadAndConditions.length > 0) {
          leadWhere.AND = leadAndConditions;
        }

        const leads = await this.prisma.lead.findMany({
          where: leadWhere,
          include: {
            stage: true,
            employee: true,
            convertedCustomer: { select: { id: true } },
            reminders: {
              where: { isCompleted: false },
              orderBy: { remindAt: 'asc' },
            },
          },
        });

        // Set of lead IDs already converted to a Customer
        const convertedLeadIds = new Set<number>();
        for (const c of allCustomersForCounts) {
          if ((c as any).leadId) convertedLeadIds.add(Number((c as any).leadId));
          if ((c as any).originLead?.id) convertedLeadIds.add(Number((c as any).originLead.id));
        }

        for (const l of leads) {
          // If already converted to or linked with a Customer, skip to prevent duplicates
          if (l.convertedCustomer || convertedLeadIds.has(l.id)) {
            this.logger.log(
              `[UPCOMING_FILTERED]\nleadId=${l.id}\nstage=${l.stage?.key || l.stage?.name || l.stageId}\nreason=already_converted_to_customer`,
            );
            continue;
          }

          const call = extractUpcomingCall({ leads: [l] }, now, finalCallStageIds, followUpStageIds);
          const leadItem = this.mapLeadToCustomerItem(l, call);
          if (call !== null) {
            leadItem.customerStatus = 'UPCOMING';
            leadItem.status = 'UPCOMING';
            leadItem.hasUpcomingCall = true;
            unconvertedUpcomingLeads.push(leadItem);
          } else {
            leadItem.customerStatus = 'INACTIVE';
            leadItem.status = 'INACTIVE';
            leadItem.hasUpcomingCall = false;
            this.logger.log(
              `[UPCOMING_FILTERED]\nleadId=${l.id}\nstage=${l.stage?.key || l.stage?.name || l.stageId}\nreason=non_upcoming_stage`,
            );
            unconvertedInactiveLeads.push(leadItem);
          }
          unconvertedAllLeads.push(leadItem);
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch leads for upcoming customer list: ${err}`);
      }
    }

    if (query.status && query.status !== 'ALL' && query.status.trim() !== '') {
      const targetStatus = query.status.trim().toUpperCase();
      if (targetStatus === 'UPCOMING') {
        where.id = { in: upcomingCustomerIds };
      } else if (targetStatus === 'ACTIVE') {
        where.id = { in: activeCustomerIds };
      } else if (targetStatus === 'INACTIVE') {
        where.id = { in: inactiveCustomerIds };
      } else if (targetStatus === 'COMPLETED') {
        where.id = { in: completedCustomerIds };
      }
    }

    const items = await this.prisma.customer.findMany({
      where,
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
        createdByEmployeeRel: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        originLead: {
          include: {
            stage: true,
            convertedByEmployee: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
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
        commissions: {
          where: {
            status: { in: [CommissionStatus.PENDING, CommissionStatus.APPROVED, CommissionStatus.PAID] },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

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

      // Priority: 1. ACTIVE, 2. UPCOMING, 3. INACTIVE
      const upcomingCall = !isSubActive ? extractUpcomingCall(c, now, finalCallStageIds, followUpStageIds) : null;
      const hasUpcomingCall = upcomingCall !== null;
      const customerStatus = isSubActive ? 'ACTIVE' : (hasUpcomingCall ? 'UPCOMING' : 'INACTIVE');
      const linkedLead = (c as any).originLead || (c as any).leads?.[0];
      const rawLeadId = linkedLead?.id ? String(linkedLead.id) : (c.leadId ? String(c.leadId) : null);
      const leadStatus = linkedLead?.status || (c.leads?.length > 0 || c.leadId ? 'WON' : null);
      const leadStageName = linkedLead?.stage?.name || (leadStatus ? 'Won' : null);
      const leadStageColor = linkedLead?.stage?.color || (leadStatus === 'WON' ? '#10B981' : '#6366F1');
      const leadStageId = linkedLead?.stage?.id || linkedLead?.stageId || null;
      const contactPerson = primaryUser
        ? `${primaryUser.firstName || ''} ${primaryUser.lastName || ''}`.trim()
        : (linkedLead ? `${linkedLead.firstName || ''} ${linkedLead.lastName || ''}`.trim() : '');

      const resolvedCompanyName = (c.companyName || linkedLead?.companyName || '').trim();
      const resolvedCustomerName = (contactPerson && contactPerson !== 'Primary Contact' && contactPerson.toLowerCase() !== resolvedCompanyName.toLowerCase())
        ? contactPerson
        : (c.name || linkedLead?.title || 'Customer');

      const primaryDisplayName = resolvedCompanyName.length > 0 ? resolvedCompanyName : (c.name || resolvedCustomerName);

      // Commission Resolution (Strict Employee Scoping & Single Source of Truth)
      const empCommissions = (c.commissions || []).filter((comm: any) => {
        if (effectiveEmployeeId) {
          return comm.employeeId === effectiveEmployeeId;
        }
        return true;
      });

      const upcomingList = empCommissions.filter(
        (comm: any) =>
          (comm.status === CommissionStatus.PENDING || comm.status === CommissionStatus.APPROVED) &&
          Number(comm.commissionAmount) > 0,
      );

      const upcomingAmount = upcomingList.reduce(
        (acc: number, curr: any) => acc + Number(curr.commissionAmount || 0),
        0,
      );

      const latestUpcoming = upcomingList[0];

      let commissionData: any = null;
      let upcomingCommissionVal: number | null = null;

      if (upcomingAmount > 0) {
        commissionData = {
          amount: upcomingAmount,
          status: 'UPCOMING',
          rate: latestUpcoming?.commissionRate,
          type: latestUpcoming?.commissionType,
        };
        upcomingCommissionVal = upcomingAmount;
      } else {
        const paidList = empCommissions.filter(
          (comm: any) => comm.status === CommissionStatus.PAID && Number(comm.commissionAmount) > 0,
        );
        if (paidList.length > 0) {
          const paidAmount = paidList.reduce(
            (acc: number, curr: any) => acc + Number(curr.commissionAmount || 0),
            0,
          );
          commissionData = {
            amount: paidAmount,
            status: 'PAID',
            paidAt: paidList[0]?.paidAt,
          };
          upcomingCommissionVal = null;
        }
      }

      return {
        id: c.id,
        customerId: `CUST-${String(c.id).padStart(4, '0')}`,
        name: c.name,
        customerName: resolvedCustomerName,
        companyName: resolvedCompanyName.length > 0 ? resolvedCompanyName : c.name,
        company: resolvedCompanyName.length > 0 ? resolvedCompanyName : c.name,
        workspaceName: resolvedCompanyName.length > 0 ? resolvedCompanyName : c.name,
        contactFirstName: primaryUser?.firstName || linkedLead?.firstName || '',
        contactLastName: primaryUser?.lastName || linkedLead?.lastName || '',
        contactFullName: contactPerson || resolvedCustomerName,
        contactPerson: contactPerson || resolvedCustomerName,
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
        wonByEmployeeId: (c as any).originLead?.convertedByEmployeeId || c.createdByEmployeeId || c.assignedEmployeeId || null,
        wonBy: (c as any).originLead?.convertedByEmployee
          ? {
              id: (c as any).originLead.convertedByEmployee.id,
              name: `${(c as any).originLead.convertedByEmployee.firstName || ''} ${(c as any).originLead.convertedByEmployee.lastName || ''}`.trim() || null,
            }
          : (c as any).createdByEmployeeRel
          ? {
              id: (c as any).createdByEmployeeRel.id,
              name: `${(c as any).createdByEmployeeRel.firstName || ''} ${(c as any).createdByEmployeeRel.lastName || ''}`.trim() || null,
            }
          : c.assignedEmployeeRel
          ? {
              id: c.assignedEmployeeRel.id,
              name: `${c.assignedEmployeeRel.firstName || ''} ${c.assignedEmployeeRel.lastName || ''}`.trim() || null,
            }
          : null,
        wonByName: (c as any).originLead?.convertedByEmployee
          ? `${(c as any).originLead.convertedByEmployee.firstName || ''} ${(c as any).originLead.convertedByEmployee.lastName || ''}`.trim() || null
          : (c as any).createdByEmployeeRel
          ? `${(c as any).createdByEmployeeRel.firstName || ''} ${(c as any).createdByEmployeeRel.lastName || ''}`.trim() || null
          : c.assignedEmployeeRel
          ? `${c.assignedEmployeeRel.firstName || ''} ${c.assignedEmployeeRel.lastName || ''}`.trim() || null
          : null,
        wonAt: (c as any).originLead?.convertedAt || c.createdAt || null,
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
        planName,
        planCode,
        billingCycle,
        subscriptionStatus: subStatus,
        subscriptionStartDate: activeSub?.startDate || null,
        subscriptionEndDate: activeSub?.endDate || null,
        subscriptionAmount: totalAmount,
        baseAmount: basePrice,
        gstAmount: gst,
        commission: commissionData,
        upcomingCommission: upcomingCommissionVal,
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

    const targetStatus = query.status ? query.status.trim().toUpperCase() : 'ALL';
    let finalItems: any[] = [];
    let effectiveTotal = 0;

    const totalActive = activeCustomerIds.length + unconvertedActiveLeads.length;
    const totalUpcoming = upcomingCustomerIds.length + unconvertedUpcomingLeads.length;
    const totalInactive = inactiveCustomerIds.length + unconvertedInactiveLeads.length;
    const totalAll = totalActive + totalUpcoming + totalInactive;

    if (targetStatus === 'UPCOMING') {
      const customerUpcoming = formatted.filter((item) => item.customerStatus === 'UPCOMING');
      const combinedUpcoming = [...customerUpcoming, ...unconvertedUpcomingLeads];
      // Sort upcoming items strictly by scheduled call date/time ascending
      combinedUpcoming.sort((a, b) => {
        const timeA = a.upcomingCall?.scheduledAt ? new Date(a.upcomingCall.scheduledAt).getTime() : 0;
        const timeB = b.upcomingCall?.scheduledAt ? new Date(b.upcomingCall.scheduledAt).getTime() : 0;
        return timeA - timeB;
      });
      effectiveTotal = combinedUpcoming.length;
      finalItems = combinedUpcoming.slice(skip, skip + limit);
    } else if (targetStatus === 'ACTIVE') {
      const customerActive = formatted.filter((item) => item.customerStatus === 'ACTIVE');
      const combinedActive = [...customerActive, ...unconvertedActiveLeads];
      effectiveTotal = combinedActive.length;
      finalItems = combinedActive.slice(skip, skip + limit);
    } else if (targetStatus === 'INACTIVE') {
      const customerInactive = formatted.filter((item) => item.customerStatus === 'INACTIVE');
      const combinedInactive = [...customerInactive, ...unconvertedInactiveLeads];
      effectiveTotal = combinedInactive.length;
      finalItems = combinedInactive.slice(skip, skip + limit);
    } else if (targetStatus === 'COMPLETED') {
      const completedItems = formatted.filter((item) => item.customerStatus === 'COMPLETED' || item.leadStatus === 'WON');
      effectiveTotal = completedItems.length;
      finalItems = completedItems.slice(skip, skip + limit);
    } else {
      // 'ALL' tab: all Active + all Upcoming + all Inactive
      const combinedAll = [...formatted, ...unconvertedAllLeads];
      effectiveTotal = combinedAll.length;
      finalItems = combinedAll.slice(skip, skip + limit);
    }

    const totalPages = Math.ceil(effectiveTotal / limit) || 1;

    // Safe Diagnostic Logs (Requirements 20 & 26)
    const employeeIdentifier =
      user?.employee?.employeeCode ||
      (effectiveEmployeeId ? `EMP-${effectiveEmployeeId}` : null) ||
      (user?.id ? `USER-${user.id}` : 'none');

    const followUpStageIdStr = Array.from(followUpStageIds || []).join(',') || 'none';
    const finalCallStageIdStr = Array.from(finalCallStageIds || []).join(',') || 'none';
    this.logger.log(
      `[CUSTOMER_UPCOMING]\nemployeeId=${employeeIdentifier}\ncompanyId=${companyId || 'none'}\nfollowUpStageId=${followUpStageIdStr}\nfinalCallStageId=${finalCallStageIdStr}\nresultCount=${totalUpcoming}`,
    );

    for (const item of finalItems) {
      const leadId = item.leadId || (item as any).lead?.id || 'none';
      const custId = item.id && item.id > 0 ? item.id : (item.customerId || 'none');
      const stageId = (item as any).lead?.stage?.id || (item as any).leadStageId || 'none';
      const stageKey = (item as any).lead?.stage?.key || (item as any).leadStatus || 'none';
      const planId = (item as any).activeSub?.planId || (item as any).planId || (item.subscriptionStatus === 'ACTIVE' ? 'ACTIVE_PLAN' : 'none');
      const planStatus = item.subscriptionStatus || 'none';
      const purchaseStatus = item.subscriptionStatus === 'ACTIVE' ? 'SUCCESS' : 'NONE';
      const classification = item.customerStatus;

      this.logger.log(
        `[CUSTOMER_CLASSIFICATION]\nleadId=${leadId}\ncustomerId=${custId}\nemployeeId=${item.assignedEmployeeId || employeeIdentifier}\nstageId=${stageId}\nstageKey=${stageKey}\nplanId=${planId}\nplanStatus=${planStatus}\npurchaseStatus=${purchaseStatus}\nclassification=${classification}`,
      );
    }

    this.logger.log(
      `[UPCOMING_QUERY]\nemployeeId=${employeeIdentifier}\nstage=FINAL_CALL\ncount=${totalUpcoming}`,
    );
    this.logger.log(
      `[CUSTOMER_QUERY]\nemployeeId=${employeeIdentifier}\ncount=${finalItems.length}`,
    );

    const safeFilter = query.status || 'ALL';
    const safeSearch = query.search ? query.search.trim().slice(0, 50) : '';
    this.logger.log(
      `[CUSTOMERS] employeeId=${employeeId || 'none'} companyId=${companyId || 'none'} filter=${safeFilter} search=${safeSearch} count=${finalItems.length} total=${effectiveTotal} (customers=${formatted.length} unconvertedUpcomingLeads=${unconvertedUpcomingLeads.length})`,
    );

    for (const c of finalItems) {
      this.logger.log(
        `[CUSTOMER_LEAD] customerId=${c.id} leadId=${c.leadId || 'none'} leadStageId=${(c as any).lead?.stage?.id || (c as any).leadStageId || 'none'} leadStageName=${c.leadStageName || 'none'} upcomingCall=${c.hasUpcomingCall ? `${c.upcomingCallType} @ ${c.upcomingCallDate} ${c.upcomingCallTime}` : 'none'}`,
      );
    }

    return {
      data: finalItems,
      items: finalItems,
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
          all: totalAll,
          active: totalActive,
          upcoming: totalUpcoming,
          inactive: totalInactive,
          completed: completedCount,
        },
      },
    };
  }

  /**
   * Helper to derive customer lifecycle status according to priority:
   * 1. ACTIVE (active purchased plan)
   * 2. UPCOMING (eligible follow-up / final call and no active plan)
   * 3. INACTIVE (no active plan and not eligible for upcoming)
   */
  public computeCustomerStatus(
    c: any,
    finalCallStageIds?: Set<number>,
    followUpStageIds?: Set<number>,
  ): 'ACTIVE' | 'UPCOMING' | 'INACTIVE' {
    const now = new Date();
    const activeSub = c.subscriptions?.find(
      (s: any) => s.status === 'ACTIVE' && (!s.endDate || new Date(s.endDate) >= now),
    );
    if (activeSub) {
      return 'ACTIVE';
    }

    const call = extractUpcomingCall(c, now, finalCallStageIds, followUpStageIds);
    if (call !== null) {
      return 'UPCOMING';
    }

    return 'INACTIVE';
  }

  /**
   * Helper to validate and convert raw customer ID to positive integer
   */
  private parseCustomerId(id: number | string): number {
    let cleanId = id;
    if (typeof id === 'string') {
      const match = id.match(/\d+/);
      if (match) {
        cleanId = match[0];
      }
    }
    const numericId = Number(cleanId);
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
        createdByEmployeeRel: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        originLead: {
          include: {
            stage: true,
            convertedByEmployee: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
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
        commissions: {
          where: {
            status: { in: [CommissionStatus.PENDING, CommissionStatus.APPROVED, CommissionStatus.PAID] },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customer || customer.deletedAt) {
      if (this.prisma.lead) {
        const lead = await this.prisma.lead.findFirst({
          where: { id: numericId, deletedAt: null },
          include: {
            stage: true,
            employee: true,
            reminders: { where: { isCompleted: false }, orderBy: { remindAt: 'asc' } },
          },
        });
        if (lead) {
          const empId = user?.employeeId || user?.employee?.id;
          const uId = user?.id || user?.sub;
          const isPrivileged = isUserSuperAdmin(user) || isUserAdmin(user);
          const isOwner =
            isPrivileged ||
            (empId && lead.employeeId === empId) ||
            (uId && lead.assignedToId === uId) ||
            (empId && lead.assignedToId === empId);
          if (!isOwner) {
            throw new ForbiddenException('You do not have permission to access details for this customer.');
          }
          const call = extractUpcomingCall({ leads: [lead] }, new Date());
          return this.mapLeadToCustomerItem(lead, call);
        }
      }
      throw new NotFoundException(`Customer #${id} not found.`);
    }

    // Tenant / Role Authorization Check
    if (user && !isUserSuperAdmin(user) && !isUserAdmin(user)) {
      const callerCustomerId = Number(user.customerId);
      const employeeId = user?.employeeId || user?.employee?.id;
      let effectiveEmployeeId = employeeId;
      if (!effectiveEmployeeId && user?.id) {
        const emp = await this.prisma.employee?.findFirst?.({
          where: { userId: user.id },
          select: { id: true },
        });
        if (emp) effectiveEmployeeId = emp.id;
      }

      const isAssignedEmployee =
        Boolean(effectiveEmployeeId && customer.assignedEmployeeId === effectiveEmployeeId);

      const isWonByEmployee =
        Boolean(effectiveEmployeeId && (
          customer.createdByEmployeeId === effectiveEmployeeId ||
          (customer as any).originLead?.convertedByEmployeeId === effectiveEmployeeId
        ));

      const isAssignedTeamMember = Boolean(
        effectiveEmployeeId &&
        (customer.assignedTeam as any)?.members?.some(
          (m: any) => m.employeeId === effectiveEmployeeId || m.employee?.id === effectiveEmployeeId,
        ),
      );

      // Check if caller is user belonging to this customer
      const isCustomerUser =
        callerCustomerId === numericId ||
        customer.users.some((u) => u.id === user.id);

      const isLeadEmployee = Boolean(
        effectiveEmployeeId &&
        customer.leads?.some(
          (l: any) => l.employeeId === effectiveEmployeeId || l.createdById === user.id || l.assignedToId === user.id,
        ),
      );

      if (!isCustomerUser && !isAssignedEmployee && !isWonByEmployee && !isLeadEmployee && !isAssignedTeamMember) {
        throw new ForbiddenException(
          'You do not have permission to access details for this customer.',
        );
      }
    }

    const employeeId = user?.employeeId || user?.employee?.id;
    let effectiveEmployeeId = employeeId;
    if (!effectiveEmployeeId && user?.id && !isUserSuperAdmin(user) && !isUserAdmin(user)) {
      const emp = await this.prisma.employee?.findFirst?.({
        where: { userId: user.id },
        select: { id: true },
      });
      if (emp) {
        effectiveEmployeeId = emp.id;
      }
    }

    const empCommissions = (customer.commissions || []).filter((comm: any) => {
      if (effectiveEmployeeId) {
        return comm.employeeId === effectiveEmployeeId;
      }
      return true;
    });

    const upcomingList = empCommissions.filter(
      (comm: any) =>
        (comm.status === CommissionStatus.PENDING || comm.status === CommissionStatus.APPROVED) &&
        Number(comm.commissionAmount) > 0,
    );

    const upcomingAmount = upcomingList.reduce(
      (acc: number, curr: any) => acc + Number(curr.commissionAmount || 0),
      0,
    );

    const latestUpcoming = upcomingList[0];

    let commissionData: any = null;
    let upcomingCommissionVal: number | null = null;

    if (upcomingAmount > 0) {
      commissionData = {
        amount: upcomingAmount,
        status: 'UPCOMING',
        rate: latestUpcoming?.commissionRate,
        type: latestUpcoming?.commissionType,
      };
      upcomingCommissionVal = upcomingAmount;
    } else {
      const paidList = empCommissions.filter(
        (comm: any) => comm.status === CommissionStatus.PAID && Number(comm.commissionAmount) > 0,
      );
      if (paidList.length > 0) {
        const paidAmount = paidList.reduce(
          (acc: number, curr: any) => acc + Number(curr.commissionAmount || 0),
          0,
        );
        commissionData = {
          amount: paidAmount,
          status: 'PAID',
          paidAt: paidList[0]?.paidAt,
        };
        upcomingCommissionVal = null;
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
      wonByEmployeeId: (customer as any).originLead?.convertedByEmployeeId || customer.createdByEmployeeId || customer.assignedEmployeeId || null,
      wonBy: (customer as any).originLead?.convertedByEmployee
        ? {
            id: (customer as any).originLead.convertedByEmployee.id,
            name: `${(customer as any).originLead.convertedByEmployee.firstName || ''} ${(customer as any).originLead.convertedByEmployee.lastName || ''}`.trim() || null,
          }
        : (customer as any).createdByEmployeeRel
        ? {
            id: (customer as any).createdByEmployeeRel.id,
            name: `${(customer as any).createdByEmployeeRel.firstName || ''} ${(customer as any).createdByEmployeeRel.lastName || ''}`.trim() || null,
          }
        : customer.assignedEmployeeRel
        ? {
            id: customer.assignedEmployeeRel.id,
            name: `${customer.assignedEmployeeRel.firstName || ''} ${customer.assignedEmployeeRel.lastName || ''}`.trim() || null,
          }
        : null,
      wonByName: (customer as any).originLead?.convertedByEmployee
        ? `${(customer as any).originLead.convertedByEmployee.firstName || ''} ${(customer as any).originLead.convertedByEmployee.lastName || ''}`.trim() || null
        : (customer as any).createdByEmployeeRel
        ? `${(customer as any).createdByEmployeeRel.firstName || ''} ${(customer as any).createdByEmployeeRel.lastName || ''}`.trim() || null
        : customer.assignedEmployeeRel
        ? `${customer.assignedEmployeeRel.firstName || ''} ${customer.assignedEmployeeRel.lastName || ''}`.trim() || null
        : null,
      wonAt: (customer as any).originLead?.convertedAt || customer.createdAt || null,
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
      commission: commissionData,
      upcomingCommission: upcomingCommissionVal,
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

    // Tenant Isolation Check: only Super Admin can delete cross-tenant records
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
      if (existing.leadId) {
        await tx.leadActivityTimeline?.deleteMany?.({ where: { leadId: existing.leadId } });
        await tx.leadNote?.deleteMany?.({ where: { leadId: existing.leadId } });
        await tx.leadReminder?.deleteMany?.({ where: { leadId: existing.leadId } });
        await tx.leadStatusHistory?.deleteMany?.({ where: { leadId: existing.leadId } });
        await tx.lead?.deleteMany?.({ where: { id: existing.leadId } });
      }
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
