import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkDto, UpdateWorkDto, SubmitWorkDto, ReviewWorkDto, AssignWorkDto } from './dto/work.dto';
import { Prisma, WorkType, WorkStatus, TaskStatus, SubscriptionStatus, SubscriptionBillingCycle } from '@prisma/client';
import {
  extractDeliverableQuotas,
  extractReelCount,
  generateReelWorkflowActivities,
  generateAllPlanWorkflowActivities,
} from '../../common/utils/plan-deliverable.util';
import { calculateSubscriptionDates } from '../../common/utils/subscription-date.util';
import { PlanScheduleGateway } from './plan-schedule.gateway';
import { WorkPermissionService, normalizeActivityType } from './work-permission.service';
import { workMatchesDesignation, workTypesForDesignation } from './calendar-query.util';
import { NotificationService } from '../notification/notification.service';

type WorkEmployee = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
};

const isPlatformAdminEmployee = (employee?: any): boolean => {
  if (!employee) return false;
  const fullName = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim().toLowerCase();
  if (fullName === 'super admin' || fullName === 'admin') return true;
  return false;
};

const getEmployeeName = (employee?: WorkEmployee | null): string | null => {
  if (!employee) return null;
  return `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || null;
};

const getWorkEmployeeFields = (work: {
  workType: string;
  assignedTo?: WorkEmployee | null;
  editor?: WorkEmployee | null;
  assignedToId?: number | null;
  editorId?: number | null;
}) => {
  const isEditing = work.workType === 'VIDEO_EDITING' || work.workType === 'EDITING';
  const hasLoadedRelations = Boolean(work.assignedTo || work.editor);
  const rawAssignedId = hasLoadedRelations && isEditing
    ? (work.editorId ?? work.assignedToId)
    : work.assignedToId;
  const responsibleEmployee = isEditing
    ? work.editor ?? work.assignedTo
    : work.assignedTo;
  const responsibleName = getEmployeeName(responsibleEmployee);
  const editorName = getEmployeeName(work.editor);

  const finalAssignedToId = responsibleEmployee?.id ?? (rawAssignedId != null ? Number(rawAssignedId) : null);
  const finalEditorId = work.editor?.id ?? (work.editorId != null ? Number(work.editorId) : null);

  return {
    assignedToId: finalAssignedToId,
    assignedEmployee: responsibleName,
    assignedToName: responsibleName,
    editorId: finalEditorId,
    editorName: editorName,
  };
};

@Injectable()
export class WorkService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkService.name);
  private carryForwardTimer: NodeJS.Timeout | null = null;
  private lastCarryForwardRunMs = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly workPermissionService?: WorkPermissionService,
    @Optional() private readonly planScheduleGateway?: PlanScheduleGateway,
    @Optional() private readonly notificationService?: NotificationService,
  ) {}

  onModuleInit() {
    // Warmup delay (12s) to allow database connections to establish
    setTimeout(() => {
      this.autoCarryForwardIncompleteWorks().catch((err) => {
        this.logger.error(`Initial carry forward check error: ${err?.message}`, err?.stack);
      });
    }, 12000);

    // Periodic check every 30 minutes for automated task carry-forward
    this.carryForwardTimer = setInterval(() => {
      this.autoCarryForwardIncompleteWorks().catch((err) => {
        this.logger.error(`Periodic carry forward check error: ${err?.message}`, err?.stack);
      });
    }, 30 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.carryForwardTimer) {
      clearInterval(this.carryForwardTimer);
      this.carryForwardTimer = null;
    }
  }

  /**
   * Helper to emit customer-isolated real-time plan/schedule events
   */
  private emitRealtimeScheduleEvent(
    customerId: number | string,
    event:
      | 'PLAN_SCHEDULE_CREATED'
      | 'PLAN_SCHEDULE_UPDATED'
      | 'PLAN_SCHEDULE_DELETED'
      | 'ACTIVE_PLAN_UPDATED'
      | 'SCHEDULE_STATUS_CHANGED',
    data?: { scheduleId?: number | string; planId?: number | string; date?: string; [key: string]: any },
  ) {
    if (this.planScheduleGateway) {
      try {
        this.planScheduleGateway.emitPlanScheduleEvent(customerId, {
          event,
          ...data,
        });
      } catch (err: any) {
        this.logger.warn(`Failed to emit real-time schedule event: ${err?.message}`);
      }
    }
  }

  /**
   * Auto carry-forward uncompleted tasks scheduled for past days in IST (UTC+05:30).
   * Safe & Idempotent: Never creates duplicate tasks. Updates the existing Work record.
   * Preserves the original scheduled date in notes and updates scheduledDate to today (or next valid working day).
   */
  async autoCarryForwardIncompleteWorks(): Promise<{ carriedForwardCount: number }> {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowUtc = new Date();
    const nowIst = new Date(nowUtc.getTime() + IST_OFFSET_MS);

    const currentIstYear = nowIst.getUTCFullYear();
    const currentIstMonth = nowIst.getUTCMonth();
    const currentIstDate = nowIst.getUTCDate();

    // Start of today in IST converted to UTC: any work scheduled strictly prior to this cutoff is from a day that has ended.
    const startOfTodayIstInUtc = new Date(
      Date.UTC(currentIstYear, currentIstMonth, currentIstDate, 0, 0, 0, 0) - IST_OFFSET_MS,
    );

    if (!this.prisma.work?.findMany) {
      return { carriedForwardCount: 0 };
    }

    // Find all uncompleted, non-cancelled works whose scheduledDate is strictly prior to start of today in IST
    const overdueWorks = await this.prisma.work.findMany({
      where: {
        scheduledDate: { lt: startOfTodayIstInUtc },
        status: {
          notIn: [WorkStatus.COMPLETED, WorkStatus.APPROVED, WorkStatus.CANCELLED],
        },
      },
      include: {
        customer: { select: { id: true, name: true, companyName: true } },
      },
    });

    if (overdueWorks.length === 0) {
      return { carriedForwardCount: 0 };
    }

    const istDateString = `${currentIstYear}-${String(currentIstMonth + 1).padStart(2, '0')}-${String(currentIstDate).padStart(2, '0')}`;
    this.logger.log(
      `[CARRY_FORWARD_CHECK] Found ${overdueWorks.length} uncompleted tasks prior to ${istDateString} IST to carry forward.`,
    );

    let carriedForwardCount = 0;

    for (const work of overdueWorks) {
      try {
        // Determine original scheduled date representation in IST
        const origDate = work.scheduledDate;
        const origIst = new Date(origDate.getTime() + IST_OFFSET_MS);
        const origY = origIst.getUTCFullYear();
        const origM = String(origIst.getUTCMonth() + 1).padStart(2, '0');
        const origD = String(origIst.getUTCDate()).padStart(2, '0');
        const origIso = `${origY}-${origM}-${origD}`;

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const origDisplay = `${origD} ${months[origIst.getUTCMonth()]} ${origY}`;

        // Check if notes already contains original schedule tag from an earlier carry-forward
        const existingNotes = work.notes || '';
        const alreadyHasOriginalTag = /\[ORIGINAL_SCHEDULE:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\]/.test(existingNotes);

        let updatedNotes = existingNotes;
        if (!alreadyHasOriginalTag) {
          const origPrefix = `[ORIGINAL_SCHEDULE:${origIso}] Originally scheduled: ${origDisplay}`;
          updatedNotes = existingNotes.trim().length > 0 ? `${origPrefix}\n${existingNotes}` : origPrefix;
        }

        // Target date in IST
        let targetIstY = currentIstYear;
        let targetIstM = currentIstMonth;
        let targetIstD = currentIstDate;

        // Check customer attendance policy for weekend/Sunday skipping
        if (work.customerId && this.prisma.attendancePolicy?.findFirst) {
          const customerPolicy = await this.prisma.attendancePolicy.findFirst({
            where: { customerId: work.customerId, isActive: true },
          });
          const workingDaysPerWeek = customerPolicy?.workingDaysPerWeek ?? 6;
          const targetDateObj = new Date(Date.UTC(targetIstY, targetIstM, targetIstD, 12, 0, 0, 0));
          const dayOfWeek = targetDateObj.getUTCDay(); // 0 = Sun, 6 = Sat

          if (workingDaysPerWeek <= 5 && (dayOfWeek === 0 || dayOfWeek === 6)) {
            const daysToAdd = dayOfWeek === 6 ? 2 : 1;
            targetDateObj.setUTCDate(targetDateObj.getUTCDate() + daysToAdd);
            targetIstY = targetDateObj.getUTCFullYear();
            targetIstM = targetDateObj.getUTCMonth();
            targetIstD = targetDateObj.getUTCDate();
          } else if (workingDaysPerWeek === 6 && dayOfWeek === 0) {
            targetDateObj.setUTCDate(targetDateObj.getUTCDate() + 1);
            targetIstY = targetDateObj.getUTCFullYear();
            targetIstM = targetDateObj.getUTCMonth();
            targetIstD = targetDateObj.getUTCDate();
          }
        }

        // Store target date at 10:00 AM IST (04:30:00 UTC) to ensure clean date matching in both UTC and IST
        const targetDateUtc = new Date(Date.UTC(targetIstY, targetIstM, targetIstD, 4, 30, 0, 0));

        // Atomic update of the SAME work record — DO NOT DUPLICATE!
        await this.prisma.work.update({
          where: { id: work.id },
          data: {
            scheduledDate: targetDateUtc,
            notes: updatedNotes,
          },
        });

        carriedForwardCount++;

        const newDateIso = `${targetIstY}-${String(targetIstM + 1).padStart(2, '0')}-${String(targetIstD).padStart(2, '0')}`;
        this.logger.log(
          `[CARRY_FORWARD_SUCCESS] Work #${work.id} ('${work.title}') moved from ${origIso} to ${newDateIso}. Status '${work.status}' preserved. Same Work ID kept.`,
        );

        // Emit real-time notification to subscribed clients
        if (work.customerId) {
          this.emitRealtimeScheduleEvent(work.customerId, 'PLAN_SCHEDULE_UPDATED', {
            scheduleId: work.id,
            date: newDateIso,
          });
        }
      } catch (err: any) {
        this.logger.error(`Failed to carry forward work #${work.id}: ${err?.message}`);
      }
    }

    return { carriedForwardCount };
  }

  /**
   * Self-contained active plan resolver using only PrismaService.
   * Replicates PlanAccessService.getEffectivePlan() without cross-module dependency.
   */
  private async getActivePlanDirect(customerId: number) {
    if (!this.prisma.customerSubscription?.findFirst) return null;

    const now = new Date();
    const sub = await this.prisma.customerSubscription.findFirst({
      where: {
        customerId,
        deletedAt: null,
        status: SubscriptionStatus.ACTIVE,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (!sub || !sub.plan) return null;

    const hasStarted = !sub.startDate || now >= new Date(sub.startDate);
    const isExpired =
      sub.status === SubscriptionStatus.EXPIRED ||
      (sub.endDate ? now > new Date(sub.endDate) : false);
    const isActive =
      sub.status === SubscriptionStatus.ACTIVE && hasStarted && !isExpired;

    const effectivePrice =
      sub.customPrice !== null && sub.customPrice !== undefined
        ? Number(sub.customPrice)
        : (sub.billingCycle === 'YEARLY'
            ? Number(sub.plan.yearlyPrice)
            : Number(sub.plan.monthlyPrice));

    const isCustomized = Boolean(
      sub.customUserLimit !== null ||
      sub.customLeadLimit !== null ||
      sub.customStorageLimit !== null ||
      sub.customFeatures !== null ||
      sub.customPrice !== null,
    );

    return {
      subscriptionId: sub.id,
      planId: sub.plan.id,
      planName: isCustomized ? 'Custom Plan' : sub.plan.name,
      planCode: isCustomized ? 'CUSTOM' : sub.plan.code,
      status: isExpired ? SubscriptionStatus.EXPIRED : sub.status,
      isExpired,
      isActive,
      billingCycle: sub.billingCycle || 'MONTHLY',
      startDate: sub.startDate || new Date(),
      endDate: sub.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      price: effectivePrice,
      isCustomized,
    };
  }

  /**
   * Helper to normalize service name matching from workType or input
   */
  private resolveServiceName(workType: WorkType, customServiceName?: string): string {
    if (customServiceName && customServiceName.trim().length > 0) {
      return customServiceName.trim();
    }
    switch (workType) {
      case WorkType.REELS_SHOOT:
      case WorkType.REEL:
      case WorkType.SHOOT:
        return 'Reels';
      case WorkType.POST_DESIGN:
      case WorkType.CREATIVE_POST:
      case WorkType.GRAPHIC_DESIGN:
        return 'Creative Posts';
      case WorkType.STORY_DESIGN:
      case WorkType.STORY:
        return 'Stories';
      case WorkType.INFLUENCER_PROMO:
      case WorkType.INFLUENCER_PROMOTION:
        return 'Influencer Promotion';
      case WorkType.VIDEO_EDITING:
      case WorkType.VIDEO:
      case WorkType.EDITING:
        return 'Video Editing';
      case WorkType.ADS_MANAGEMENT:
      case WorkType.META_ADS:
      case WorkType.GOOGLE_ADS:
        return 'Meta & Google Ads';
      case WorkType.CONTENT_WRITING:
        return 'Content Writing';
      case WorkType.SOCIAL_MEDIA_MANAGEMENT:
        return 'Social Media Management';
      case WorkType.PERFORMANCE_REPORT:
        return 'Performance Report';
      default:
        return 'Reels';
    }
  }

  /**
   * Helper to resolve customer ID from numeric values or clean integers
   */
  private resolveCustomerId(customerId?: number | string): number | undefined {
    if (customerId === null || customerId === undefined) return undefined;
    if (typeof customerId === 'number') {
      return !isNaN(customerId) && customerId > 0 ? customerId : undefined;
    }
    const str = String(customerId).trim();
    if (!str) return undefined;
    const directNum = parseInt(str, 10);
    if (!isNaN(directNum) && String(directNum) === str && directNum > 0) {
      return directNum;
    }

    const qbMatch = str.match(/^(?:QB-)?(?:CUST|CADMIN|USER|EMP|ADMIN|CUSTOMER|CLIENT|TENANT)?[_-]?0*([0-9]+)$/i) ||
                    str.match(/^T0*([0-9]+)$/i);
    if (qbMatch && qbMatch[1]) {
      const extractedNum = parseInt(qbMatch[1], 10);
      if (!isNaN(extractedNum) && extractedNum > 0) {
        return extractedNum;
      }
    }

    return undefined;
  }

  /**
   * List work items with tenant/role scoping, status filtering, and pagination.
   */
  async findAll(
    scopedCustomerId?: number | string,
    query: {
      status?: WorkStatus;
      workType?: WorkType;
      employeeId?: number | string;
      editorId?: number | string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    const resolvedCustId = this.resolveCustomerId(scopedCustomerId);
    if (resolvedCustId) {
      where.customerId = resolvedCustId;
    }

    if (query.status) where.status = query.status;
    if (query.workType) where.workType = query.workType;

    if (query.employeeId && !isNaN(Number(query.employeeId))) {
      where.assignedToId = Number(query.employeeId);
    }

    if (query.editorId && !isNaN(Number(query.editorId))) {
      where.editorId = Number(query.editorId);
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { notes: { contains: s, mode: 'insensitive' } },
        { customer: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.work.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledDate: 'desc' },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          team: true,
          assignedTo: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true },
          },
          editor: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true },
          },
          entitlement: true,
          tasks: {
            include: {
              assignedTo: true,
            },
            orderBy: { stepOrder: 'asc' },
          },
        },
      }),
      this.prisma.work.count({ where }),
    ]);

    const mappedItems = items.map((work) => ({
      ...work,
      ...getWorkEmployeeFields(work),
    }));

    return {
      items: mappedItems,
      data: mappedItems,
      pagination: {
        page,
        pageSize: limit,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Find single work item with tasks, employee, editor, and entitlement details.
   */
  async findOne(scopedCustomerId: number | string | undefined, id: number | string) {
    const numId = Number(id);
    const where: any = { id: numId };

    if (scopedCustomerId && !isNaN(Number(scopedCustomerId)) && Number(scopedCustomerId) > 0) {
      where.customerId = Number(scopedCustomerId);
    }

    const work = await this.prisma.work.findFirst({
      where,
      include: {
        customer: true,
        team: true,
        assignedTo: true,
        editor: true,
        entitlement: true,
        tasks: {
          include: {
            assignedTo: true,
          },
          orderBy: { stepOrder: 'asc' },
        },
      },
    });

    if (!work) {
      throw new NotFoundException(`Work schedule with ID ${id} not found`);
    }

    return work;
  }

  /**
   * Employee may schedule only against an authorized tenant customer.
   * Calendar CREATE with allowTenantCustomers skips assignment ownership.
   */
  async assertEmployeeCanScheduleForCustomer(
    employeeId: number,
    targetCustomerId: number,
    options?: { allowTenantCustomers?: boolean },
  ): Promise<void> {
    const numEmployeeId = Number(employeeId);
    const numCustomerId = Number(targetCustomerId);
    if (!numEmployeeId || !numCustomerId) {
      throw new BadRequestException('Valid employee and customer are required to schedule.');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: numEmployeeId },
      select: { id: true, customerId: true, status: true },
    });
    if (!employee) {
      throw new ForbiddenException('Employee profile not found');
    }

    if (options?.allowTenantCustomers) {
      const tenantCustomer = await this.prisma.customer.findFirst({
        where: { id: numCustomerId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!tenantCustomer) {
        throw new NotFoundException('Customer/resource not found');
      }
      return;
    }

    if (employee.customerId === numCustomerId) {
      return;
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: numCustomerId, deletedAt: null },
      select: { id: true, assignedEmployeeId: true, assignedTeamId: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer/resource not found');
    }

    if (customer.assignedEmployeeId === numEmployeeId) {
      return;
    }

    const employeeIsActive =
      !employee.status || String(employee.status).toUpperCase() === 'ACTIVE';
    if (customer.assignedTeamId && employeeIsActive) {
      const team = await this.prisma.team.findFirst({
        where: {
          id: customer.assignedTeamId,
          isActive: true,
          customerId: employee.customerId,
          OR: [
            { leaderId: numEmployeeId },
            { members: { some: { employeeId: numEmployeeId } } },
          ],
        },
        select: { id: true },
      });
      if (team) {
        return;
      }
    }

    throw new ForbiddenException(
      'You are not authorized to schedule calendar events for this customer.',
    );
  }

  /**
   * Customer Create Schedule with atomic plan quota verification and reservation.
   */
  async create(scopedCustomerId: number | string, dto: CreateWorkDto) {
    const numCustomerId = Number(scopedCustomerId);
    if (!numCustomerId || isNaN(numCustomerId)) {
      throw new BadRequestException('Valid customer context required');
    }

    // 1. Verify Active Subscription & Expiration
    const activePlan = await this.getActivePlanDirect(numCustomerId);
    if (!activePlan || !activePlan.isActive || activePlan.isExpired) {
      throw new BadRequestException('Cannot create schedule. Your plan is inactive or expired. Please renew.');
    }

    // 2. Validate Non-working Day / Sunday Rule
    const schedDate = new Date(dto.scheduledDate);
    if (isNaN(schedDate.getTime())) {
      throw new BadRequestException('Invalid scheduledDate format');
    }
    if (schedDate.getDay() === 0) { // 0 = Sunday
      const customerPolicy = await this.prisma.attendancePolicy.findFirst({
        where: { customerId: numCustomerId, isActive: true },
      });
      if (customerPolicy && customerPolicy.workingDaysPerWeek <= 5) {
        throw new BadRequestException('Scheduling is not allowed on Sundays according to working calendar policy.');
      }
    }

    // 3. Resolve Service Name and Check / Initialize Entitlement
    const serviceName = this.resolveServiceName(dto.workType, dto.serviceName);

    const result = await this.prisma.$transaction(async (tx) => {
      // Find or create PlanEntitlement for this service
      let entitlement = await tx.planEntitlement.findFirst({
        where: { customerId: numCustomerId, serviceName },
      });

      if (!entitlement) {
        // Look up default quota based on active plan features or standard tier defaults
        let defaultQty = 4;
        if (serviceName.toLowerCase().includes('reel')) {
          defaultQty = activePlan.planCode === 'PREMIUM' ? 10 : (activePlan.planCode === 'STANDARD' ? 6 : 4);
        } else if (serviceName.toLowerCase().includes('post') || serviceName.toLowerCase().includes('creative')) {
          defaultQty = activePlan.planCode === 'PREMIUM' ? 6 : (activePlan.planCode === 'STANDARD' ? 4 : 3);
        } else if (serviceName.toLowerCase().includes('story') || serviceName.toLowerCase().includes('stories')) {
          defaultQty = activePlan.planCode === 'PREMIUM' ? 8 : (activePlan.planCode === 'STANDARD' ? 5 : 3);
        } else if (serviceName.toLowerCase().includes('influencer')) {
          defaultQty = activePlan.planCode === 'PREMIUM' ? 3 : (activePlan.planCode === 'STANDARD' ? 2 : 1);
        }

        entitlement = await tx.planEntitlement.create({
          data: {
            customerId: numCustomerId,
            planId: activePlan.planId,
            serviceName,
            totalQty: defaultQty,
            usedQty: 0,
            scheduledQty: 0,
            validUntil: activePlan.endDate,
          },
        });
      }

      // Check remaining quota: remaining = totalQty - (usedQty + scheduledQty)
      const remaining = entitlement.totalQty - (entitlement.usedQty + entitlement.scheduledQty);
      if (remaining <= 0) {
        throw new BadRequestException(
          `No ${serviceName} quota remaining in your current plan. (${entitlement.totalQty} total, ${entitlement.usedQty} used, ${entitlement.scheduledQty} scheduled).`,
        );
      }

      // Reserve 1 quota unit (SCHEDULED -> RESERVED)
      await tx.planEntitlement.update({
        where: { id: entitlement.id },
        data: { scheduledQty: { increment: 1 } },
      });

      // Resolve Purchase (Subscription)
      let resolvedSubscriptionId: number | null = null;
      if (dto.subscriptionId) {
        const sub = await tx.customerSubscription.findUnique({
          where: { id: Number(dto.subscriptionId) },
        });
        if (sub) resolvedSubscriptionId = sub.id;
      } else if (dto.purchaseId) {
        const parsed = Number(dto.purchaseId.replace(/\D/g, ''));
        if (!isNaN(parsed) && parsed > 0) {
          const sub = await tx.customerSubscription.findUnique({
            where: { id: parsed },
          });
          if (sub) resolvedSubscriptionId = sub.id;
        }
      }
      if (!resolvedSubscriptionId) {
        const activeSub = await tx.customerSubscription.findFirst({
          where: { customerId: numCustomerId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (activeSub) resolvedSubscriptionId = activeSub.id;
      }

      const customerRecord = await tx.customer.findUnique({
        where: { id: numCustomerId },
        select: { assignedTeamId: true, assignedEmployeeId: true },
      });
      const resolvedTeamId = dto.teamId
        ? Number(dto.teamId)
        : (customerRecord?.assignedTeamId || null);
      let resolvedAssignedToId = dto.assignedToId
        ? await this.resolveCanonicalEmployeeId(dto.assignedToId, numCustomerId)
        : null;
      let resolvedEditorId = dto.editorId
        ? await this.resolveCanonicalEmployeeId(dto.editorId, numCustomerId)
        : null;

      // Auto-assign from team members if not explicitly provided
      if (!resolvedAssignedToId && resolvedTeamId) {
        const team = await tx.team.findUnique({
          where: { id: resolvedTeamId },
          include: {
            members: {
              include: {
                employee: {
                  select: {
                    id: true,
                    customerId: true,
                    status: true,
                    firstName: true,
                    lastName: true,
                    designation: { select: { name: true } },
                    department: { select: { name: true } },
                  },
                },
              },
            },
          },
        });
        const teamLabel = `${team?.name || ''} ${team?.description || ''}`.toUpperCase();
        if (team && !teamLabel.includes('BPO') && (team.members || []).length > 0) {
          const eligibleMemberIds = await this.eligibleProductionMemberIds(
            { workType: dto.workType, title: dto.title, description: dto.description },
            team.members,
            team.customerId,
          );
          if (eligibleMemberIds.length > 0) {
            resolvedAssignedToId = eligibleMemberIds[0];
          }

          // If this is a video/reel activity, also match an eligible editor
          const isReelOrVideo =
            dto.workType === WorkType.REEL ||
            dto.workType === WorkType.REELS_SHOOT ||
            dto.workType === WorkType.SHOOT ||
            dto.workType === WorkType.EDITING ||
            (dto.title && /reel|shoot|video|edit/i.test(dto.title));
          if (isReelOrVideo && !resolvedEditorId) {
            const editorEligibleIds = await this.eligibleProductionMemberIds(
              { workType: WorkType.EDITING, title: 'Video Editing' },
              team.members,
              team.customerId,
            );
            if (editorEligibleIds.length > 0) {
              resolvedEditorId = editorEligibleIds[0];
            }
          }
        }
      }

      // A lead's customer owner is not automatically its production task assignee.
      if (!resolvedAssignedToId && customerRecord?.assignedEmployeeId) {
        const owner = await tx.employee.findUnique({
          where: { id: Number(customerRecord.assignedEmployeeId) },
          select: { id: true, customerId: true, status: true, designation: { select: { name: true } }, department: { select: { name: true } } },
        });
        const eligibleOwners = owner ? await this.eligibleProductionMemberIds(
          { workType: dto.workType, title: dto.title, description: dto.description },
          [{ employeeId: owner.id, employee: owner }], owner.customerId,
        ) : [];
        resolvedAssignedToId = eligibleOwners[0] ?? null;
      }

      if (dto.workType === WorkType.EDITING && resolvedEditorId) {
        resolvedAssignedToId = resolvedEditorId;
      }

      if (resolvedAssignedToId) {
        const perm = await this.workPermissionService.getAllowedActivityTypesForEmployee(
          resolvedAssignedToId,
          numCustomerId,
        );
        const normalizedType = normalizeActivityType({
          workType: dto.workType,
          title: dto.title,
          description: dto.description,
        });
        if (!perm.isFullAccess && !perm.allowedTypes.has(normalizedType)) {
          throw new BadRequestException(
            `Cannot assign activity '${dto.title || normalizedType}' to employee #${resolvedAssignedToId}. Their role '${perm.role}' does not support '${normalizedType}'.`,
          );
        }
      }

      if (resolvedEditorId) {
        const edId = Number(resolvedEditorId);
        const perm = await this.workPermissionService.getAllowedActivityTypesForEmployee(
          edId,
          numCustomerId,
        );
        if (!perm.isFullAccess && !perm.allowedTypes.has('REEL_EDIT')) {
          throw new BadRequestException(
            `Cannot assign editor role to employee #${edId}. Their role '${perm.role}' does not support Video Editing.`,
          );
        }
      }

      const workStatus = (resolvedAssignedToId || resolvedEditorId)
        ? WorkStatus.ASSIGNED
        : WorkStatus.SCHEDULED;

      // Create Work deliverable record
      const work = await tx.work.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: resolvedSubscriptionId,
          planId: activePlan.planId,
          entitlementId: entitlement.id,
          teamId: resolvedTeamId,
          assignedToId: resolvedAssignedToId,
          editorId: resolvedEditorId,
          workType: dto.workType,
          title: dto.title,
          description: dto.description,
          scheduledDate: schedDate,
          scheduledTime: dto.scheduledTime || '10:00 AM',
          priority: dto.priority || 'MEDIUM',
          status: workStatus,
          notes: dto.notes,
        },
        include: {
          customer: true,
          assignedTo: true,
          editor: true,
          entitlement: true,
          subscription: {
            include: { plan: true },
          },
        },
      });

      // Auto-create multi-step deliverable pipeline tasks
      if (
        dto.workType === WorkType.REELS_SHOOT ||
        dto.workType === WorkType.REEL ||
        dto.workType === WorkType.SHOOT
      ) {
        await tx.workTask.createMany({
          data: [
            { workId: work.id, title: 'Reels Video Shoot', stepOrder: 1, status: TaskStatus.PENDING, assignedToId: work.assignedToId },
            { workId: work.id, title: 'Video Editing & Color Grading', stepOrder: 2, status: TaskStatus.PENDING, assignedToId: work.editorId || work.assignedToId },
            { workId: work.id, title: 'Customer Review & Approval', stepOrder: 3, status: TaskStatus.PENDING, assignedToId: work.assignedToId },
            { workId: work.id, title: 'Social Media Feed Upload', stepOrder: 4, status: TaskStatus.PENDING, assignedToId: work.assignedToId },
          ],
        });
      } else {
        await tx.workTask.createMany({
          data: [
            { workId: work.id, title: `${work.title || 'Work'} - Asset Preparation`, stepOrder: 1, status: TaskStatus.PENDING, assignedToId: work.assignedToId },
            { workId: work.id, title: `${work.title || 'Work'} - Content Execution`, stepOrder: 2, status: TaskStatus.PENDING, assignedToId: work.assignedToId },
            { workId: work.id, title: `${work.title || 'Work'} - Review & Approval`, stepOrder: 3, status: TaskStatus.PENDING, assignedToId: work.assignedToId },
          ],
        });
      }

      // Notify customer user
      const customerUser = await tx.user.findFirst({
        where: { customerId: numCustomerId, isActive: true },
      });
      if (customerUser) {
        await tx.notification.create({
          data: {
            customerId: numCustomerId,
            userId: customerUser.id,
            title: 'Schedule Created',
            message: `Your ${serviceName} schedule "${work.title}" on ${schedDate.toLocaleDateString()} has been scheduled successfully.`,
            type: 'SCHEDULE_CREATED',
            data: { workId: work.id, serviceName },
          },
        });
      }

      return work;
    });

    this.emitRealtimeScheduleEvent(result.customerId, 'PLAN_SCHEDULE_CREATED', {
      scheduleId: result.id,
      planId: result.subscriptionId,
      date: result.scheduledDate ? new Date(result.scheduledDate).toISOString().split('T')[0] : undefined,
    });

    // 9. CUSTOMER CALENDAR SCHEDULE -> CUSTOMER NOTIFICATION
    if (this.notificationService && result.customerId) {
      const assignedEmployeeName = result.assignedTo
        ? `${result.assignedTo.firstName || ''} ${result.assignedTo.lastName || ''}`.trim()
        : null;
      this.notificationService
        .sendCalendarScheduledNotification({
          customerId: result.customerId,
          workId: result.id,
          title: result.title || serviceName || 'Scheduled Activity',
          scheduledDate: result.scheduledDate,
          scheduledTime: result.scheduledTime,
          employeeName: assignedEmployeeName,
          serviceName,
        })
        .catch((err) => {
          this.logger.warn(`Failed to dispatch CALENDAR_SCHEDULE_CREATED push: ${err?.message}`);
        });
    }

    // Immediate Push Notification to Assigned Employee
    if (this.notificationService && result.assignedToId) {
      this.notificationService
        .sendWorkAssignmentNotification(result.assignedToId, result, false)
        .catch((err) => {
          this.logger.error(`Failed to send work assignment notification: ${err?.message}`);
        });
    }

    return result;
  }

  /**
   * Update work details, dates, or basic metadata.
   */
  async update(
    scopedCustomerId: number | string | undefined,
    id: number | string,
    dto: UpdateWorkDto,
    employeeId?: number,
  ) {
    const numId = Number(id);
    let existing: any;
    if (employeeId) {
      existing = await this.prisma.work.findFirst({
        where: {
          id: numId,
          OR: [
            { assignedToId: employeeId },
            { editorId: employeeId },
            { tasks: { some: { assignedToId: employeeId } } },
            { team: { members: { some: { employeeId } } } },
            { team: { leaderId: employeeId } },
            ...(scopedCustomerId ? [{ customerId: Number(scopedCustomerId) }] : []),
          ],
        },
      });
    }
    if (!existing) {
      existing = await this.findOne(scopedCustomerId, numId);
    }
    if (dto.assignedToId) {
      const targetEmpId = Number(dto.assignedToId);
      const perm = await this.workPermissionService.getAllowedActivityTypesForEmployee(targetEmpId, existing.customerId);
      const normalizedType = normalizeActivityType(existing);
      if (!perm.isFullAccess && !perm.allowedTypes.has(normalizedType)) {
        throw new BadRequestException(
          `Cannot assign activity '${existing.title || normalizedType}' to employee #${targetEmpId}. Their role '${perm.role}' does not support '${normalizedType}'.`,
        );
      }
    }
    if (dto.editorId) {
      const targetEditorId = Number(dto.editorId);
      const perm = await this.workPermissionService.getAllowedActivityTypesForEmployee(targetEditorId, existing.customerId);
      if (!perm.isFullAccess && !perm.allowedTypes.has('REEL_EDIT')) {
        throw new BadRequestException(
          `Cannot assign editor role to employee #${targetEditorId}. Their role '${perm.role}' does not support Video Editing.`,
        );
      }
    }

    const updateData: any = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.outputUrl !== undefined) updateData.outputUrl = dto.outputUrl;
    if (dto.priority !== undefined) updateData.priority = dto.priority;
    if (dto.scheduledTime !== undefined) updateData.scheduledTime = dto.scheduledTime;
    if (dto.scheduledDate) updateData.scheduledDate = new Date(dto.scheduledDate);
    if (dto.assignedToId !== undefined) updateData.assignedToId = dto.assignedToId ? Number(dto.assignedToId) : null;
    if (dto.editorId !== undefined) updateData.editorId = dto.editorId ? Number(dto.editorId) : null;
    if (
      dto.assignedToId &&
      existing.status === WorkStatus.SCHEDULED &&
      dto.status === undefined
    ) {
      updateData.status = WorkStatus.ASSIGNED;
    }

    if (dto.status) {
      updateData.status = dto.status;
      if (dto.status === WorkStatus.COMPLETED && existing.status !== WorkStatus.COMPLETED) {
        updateData.completedAt = new Date();
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Handle quota transition if status changed to COMPLETED or CANCELLED
      if (dto.status === WorkStatus.COMPLETED && existing.status !== WorkStatus.COMPLETED && existing.entitlementId) {
        await tx.planEntitlement.update({
          where: { id: existing.entitlementId },
          data: {
            scheduledQty: { decrement: 1 },
            usedQty: { increment: 1 },
          },
        });
      } else if (dto.status === WorkStatus.CANCELLED && existing.status !== WorkStatus.CANCELLED && existing.entitlementId) {
        if (existing.status !== WorkStatus.COMPLETED) {
          await tx.planEntitlement.update({
            where: { id: existing.entitlementId },
            data: {
              scheduledQty: { decrement: 1 },
            },
          });
        }
      }

      const updatedWork = await tx.work.update({
        where: { id: numId },
        data: updateData,
        include: {
          customer: true,
          assignedTo: true,
          editor: true,
          entitlement: true,
          tasks: true,
        },
      });

      if (dto.assignedToId !== undefined) {
        const previousAssignee = existing.assignedToId != null ? Number(existing.assignedToId) : null;
        const nextAssignee = updatedWork.assignedToId != null ? Number(updatedWork.assignedToId) : null;
        await tx.workTask.updateMany({
          where: {
            workId: numId,
            OR: [
              ...(previousAssignee ? [{ assignedToId: previousAssignee }] : []),
              { assignedToId: null },
            ],
            NOT: {
              title: { contains: 'Edit', mode: 'insensitive' },
            },
          },
          data: { assignedToId: nextAssignee },
        });
      }

      if (dto.editorId !== undefined) {
        const nextEditor = updatedWork.editorId != null ? Number(updatedWork.editorId) : null;
        await tx.workTask.updateMany({
          where: {
            workId: numId,
            OR: [
              { stepOrder: 2 },
              { title: { contains: 'Edit', mode: 'insensitive' } },
            ],
          },
          data: { assignedToId: nextEditor },
        });
      }

      return updatedWork;
    });

    this.emitRealtimeScheduleEvent(result.customerId, 'PLAN_SCHEDULE_UPDATED', {
      scheduleId: result.id,
      planId: result.subscriptionId,
      date: result.scheduledDate ? new Date(result.scheduledDate).toISOString().split('T')[0] : undefined,
    });

    // 11. EMPLOYEE START WORK -> CUSTOMER NOTIFICATION
    if (
      this.notificationService &&
      existing.status !== WorkStatus.IN_PROGRESS &&
      dto.status === WorkStatus.IN_PROGRESS
    ) {
      try {
        const existingNotifs = await this.prisma.notification.findMany({
          where: {
            customerId: result.customerId,
            type: 'WORK_STARTED',
          },
          select: { data: true },
          take: 50,
          orderBy: { id: 'desc' },
        });
        const alreadyNotified = existingNotifs.some((n: any) => n.data?.workId === String(result.id));

        if (!alreadyNotified) {
          const employeeName =
            result.assignedTo
              ? `${result.assignedTo.firstName || ''} ${result.assignedTo.lastName || ''}`.trim() || 'Assigned Specialist'
              : 'Our specialist';
          const workTitle = result.title || 'Work Task';
          const startDateTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

          await this.notificationService.sendPushNotification({
            customerId: result.customerId,
            title: '🚀 Work Started',
            body: `${employeeName} has started working on "${workTitle}". Status: In Progress (${startDateTime}).`,
            type: 'WORK_STARTED',
            data: {
              type: 'WORK',
              workId: String(result.id),
              customerId: String(result.customerId),
              employeeName,
              workTitle,
              status: 'IN_PROGRESS',
              startDateTime,
            },
          });
          this.logger.log(`Dispatched WORK_STARTED notification to customer #${result.customerId} for work #${result.id}`);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to dispatch WORK_STARTED notification (non-fatal): ${err?.message}`);
      }
    }

    // 12. TASK RESCHEDULE -> PARTICULAR EMPLOYEE NOTIFICATION (via update)
    const oldDateStr = existing.scheduledDate ? new Date(existing.scheduledDate).toISOString().split('T')[0] : '';
    const newDateStr = dto.scheduledDate ? new Date(dto.scheduledDate).toISOString().split('T')[0] : oldDateStr;
    const oldTimeStr = (existing.scheduledTime || '').trim();
    const newTimeStr = dto.scheduledTime !== undefined ? (dto.scheduledTime || '').trim() : oldTimeStr;

    const isRescheduled = (dto.scheduledDate !== undefined && newDateStr !== oldDateStr) ||
                          (dto.scheduledTime !== undefined && newTimeStr !== oldTimeStr);

    const customerName = result.customer?.companyName || result.customer?.name || null;
    const wasCancelled = existing.status !== WorkStatus.CANCELLED && result.status === WorkStatus.CANCELLED;
    const assigneeChanged = dto.assignedToId !== undefined && Number(dto.assignedToId) !== Number(existing.assignedToId);

    if (this.notificationService && result.assignedToId && (isRescheduled || wasCancelled)) {
      this.notificationService
        .sendTaskRescheduledNotification({
          customerId: result.customerId,
          employeeId: result.assignedToId,
          workId: result.id,
          taskName: result.title || 'Task',
          newDate: result.scheduledDate,
          newTime: result.scheduledTime,
          previousDate: oldDateStr,
          previousTime: oldTimeStr,
          customerName,
          cancelled: wasCancelled,
        })
        .catch((err) => {
          this.logger.warn(`Failed to dispatch TASK_RESCHEDULED push: ${err?.message}`);
        });
    } else if (this.notificationService && assigneeChanged && result.assignedToId) {
      this.notificationService
        .sendWorkAssignmentNotification(result.assignedToId, result, true)
        .catch((err) => {
          this.logger.warn(`Failed to dispatch reassignment notification: ${err?.message}`);
        });
    }

    // Notification 5: Level / Work Approved via update & Customer Work Completed
    const isStatusChangingToCompleted =
      String(existing.status || '').toUpperCase() !== 'COMPLETED' &&
      (dto.status === WorkStatus.COMPLETED || String(dto.status || '').toUpperCase() === 'COMPLETED');

    if (this.notificationService && isStatusChangingToCompleted) {
      const staffUserIds = [result.assignedTo?.userId, result.editor?.userId].filter(Boolean) as number[];
      for (const uid of staffUserIds) {
        try {
          const existingNotifs = await this.prisma.notification.findMany({
            where: {
              userId: uid,
              type: 'LEVEL_APPROVED',
            },
            select: { data: true },
            take: 20,
            orderBy: { id: 'desc' },
          });
          const alreadyNotified = existingNotifs.some((n: any) => n.data?.workId === String(result.id));
          if (!alreadyNotified) {
            await this.notificationService.sendPushNotification({
              userId: uid,
              customerId: result.customerId,
              title: '✅ Level Approved',
              body: `Your submitted level for "${result.title}" has been approved by Admin.`,
              type: 'LEVEL_APPROVED',
              data: {
                type: 'WORK',
                workId: String(result.id),
                status: 'APPROVED',
              },
            });
            this.logger.log(`Dispatched LEVEL_APPROVED push notification to staff user #${uid} for work #${result.id}`);
          }
        } catch (err: any) {
          this.logger.warn(`Failed to send level approval push to staff user #${uid} (non-fatal): ${err?.message}`);
        }
      }

      await this.notifyCustomerWorkCompleted(result);
    }

    return result;
  }

  /**
   * Employee / Editor Submits Final Deliverable / Content Link
   */
  async submitWork(
    scopedCustomerId: number | string | undefined,
    id: number | string,
    dto: SubmitWorkDto,
    employeeUserId?: number | string,
  ) {
    const numId = Number(id);
    const existing = await this.findOne(scopedCustomerId, numId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const work = await tx.work.update({
        where: { id: numId },
        data: {
          outputUrl: dto.outputUrl,
          notes: dto.notes ? `${existing.notes || ''}\n[Submission Notes]: ${dto.notes}`.trim() : existing.notes,
          status: WorkStatus.CUSTOMER_REVIEW,
          submittedAt: new Date(),
        },
        include: {
          customer: true,
          assignedTo: true,
          editor: true,
        },
      });

      // Update intermediate work tasks
      await tx.workTask.updateMany({
        where: { workId: numId, stepOrder: { in: [1, 2] } },
        data: { status: TaskStatus.COMPLETED },
      });

      // Notify customer for review
      const customerUser = await tx.user.findFirst({
        where: { customerId: work.customerId, isActive: true },
      });
      if (customerUser) {
        await tx.notification.create({
          data: {
            customerId: work.customerId,
            userId: customerUser.id,
            title: 'Content Ready for Review',
            message: `Deliverable for "${work.title}" has been submitted by your creative team. Please review and approve.`,
            type: 'WORK_SUBMITTED',
            data: { workId: work.id, outputUrl: work.outputUrl },
          },
        });
      }

      return work;
    });

    if (this.notificationService && updated.customerId) {
      try {
        await this.notificationService.sendPushNotification({
          customerId: updated.customerId,
          title: 'Content Ready for Review',
          body: `Deliverable for "${updated.title}" has been submitted by your creative team. Please review and approve.`,
          type: 'WORK_SUBMITTED',
          data: {
            type: 'WORK_SUBMITTED',
            workId: String(updated.id),
            outputUrl: updated.outputUrl || '',
            route: '/customer/work-requests',
          },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to dispatch WORK_SUBMITTED push notification (non-fatal): ${err?.message}`);
      }
    }

    return {
      success: true,
      message: 'Work deliverable submitted for customer review.',
      work: updated,
    };
  }

  /**
   * Customer Approves Deliverable -> Completed & Consumes Quota
   */
  async approveWork(scopedCustomerId: number | string, id: number | string) {
    const numCustomerId = Number(scopedCustomerId);
    const numId = Number(id);
    const existing = await this.findOne(numCustomerId, numId);

    if (existing.status === WorkStatus.COMPLETED) {
      return { success: true, message: 'Work already approved and completed.', work: existing };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Mark COMPLETED
      const work = await tx.work.update({
        where: { id: numId },
        data: {
          status: WorkStatus.COMPLETED,
          approvedAt: new Date(),
          completedAt: new Date(),
        },
        include: {
          customer: true,
          assignedTo: true,
          editor: true,
          entitlement: true,
        },
      });

      // 2. Complete all tasks
      await tx.workTask.updateMany({
        where: { workId: numId },
        data: { status: TaskStatus.COMPLETED },
      });

      // 3. Consume quota (SCHEDULED -> CONSUMED: scheduledQty - 1, usedQty + 1)
      if (work.entitlementId) {
        await tx.planEntitlement.update({
          where: { id: work.entitlementId },
          data: {
            scheduledQty: { decrement: 1 },
            usedQty: { increment: 1 },
          },
        });
      }

      // 4. Fallback in-DB notification if notificationService not available
      const staffUserIds = [work.assignedTo?.userId, work.editor?.userId].filter(Boolean) as number[];
      if (!this.notificationService) {
        for (const uid of staffUserIds) {
          await tx.notification.create({
            data: {
              customerId: work.customerId,
              userId: uid,
              title: '✅ Level Approved',
              message: `Your submitted level for "${work.title}" has been approved by Admin.`,
              type: 'LEVEL_APPROVED',
              data: { workId: work.id },
            },
          });
        }
      }

      return {
        success: true,
        message: 'Content approved successfully! Schedule is now completed.',
        work,
      };
    });

    // 5. Notify assigned staff via Push Notification + FCM
    if (this.notificationService) {
      const staffUserIds = [result.work.assignedTo?.userId, result.work.editor?.userId].filter(Boolean) as number[];
      for (const uid of staffUserIds) {
        try {
          const existingNotifs = await this.prisma.notification.findMany({
            where: {
              userId: uid,
              type: 'LEVEL_APPROVED',
            },
            select: { data: true },
            take: 20,
            orderBy: { id: 'desc' },
          });
          const alreadyNotified = existingNotifs.some((n: any) => n.data?.workId === String(result.work.id));
          if (!alreadyNotified) {
            await this.notificationService.sendPushNotification({
              userId: uid,
              customerId: result.work.customerId,
              title: '✅ Level Approved',
              body: `Your submitted level for "${result.work.title}" has been approved by Admin.`,
              type: 'LEVEL_APPROVED',
              data: {
                type: 'WORK',
                workId: String(result.work.id),
                status: 'APPROVED',
              },
            });
            this.logger.log(`Dispatched LEVEL_APPROVED push notification to staff user #${uid} for work #${result.work.id}`);
          }
        } catch (err: any) {
          this.logger.warn(`Failed to send level approval push to staff user #${uid} (non-fatal): ${err?.message}`);
        }
      }

      await this.notifyCustomerWorkCompleted(result.work);
    }

    return result;
  }

  /**
   * Customer Requests Revision
   */
  async requestRevision(scopedCustomerId: number | string, id: number | string, dto: ReviewWorkDto) {
    const numCustomerId = Number(scopedCustomerId);
    const numId = Number(id);
    const existing = await this.findOne(numCustomerId, numId);

    if (existing.status === WorkStatus.COMPLETED) {
      throw new BadRequestException('Cannot request revision on an already approved/completed work item.');
    }

    return this.prisma.$transaction(async (tx) => {
      const work = await tx.work.update({
        where: { id: numId },
        data: {
          status: WorkStatus.REVISION_REQUESTED,
          feedback: dto.feedback,
          revisionCount: { increment: 1 },
          notes: `${existing.notes || ''}\n[Revision #${existing.revisionCount + 1}]: ${dto.feedback}`.trim(),
        },
        include: {
          customer: true,
          assignedTo: true,
          editor: true,
        },
      });

      // Notify editor / assigned employee
      const staffUserIds = [work.editor?.userId, work.assignedTo?.userId].filter(Boolean) as number[];
      for (const uid of staffUserIds) {
        await tx.notification.create({
          data: {
            customerId: work.customerId,
            userId: uid,
            title: 'Revision Requested',
            message: `Customer requested revision on "${work.title}": "${dto.feedback}"`,
            type: 'REVISION_REQUESTED',
            data: { workId: work.id, feedback: dto.feedback, revisionCount: work.revisionCount },
          },
        });
      }

      return {
        success: true,
        message: 'Revision requested. Your editor has been notified with feedback.',
        work,
      };
    });
  }

  /**
   * Admin / Manager Assign Employee & Editor
   */
  async assignTeam(scopedCustomerId: number | string | undefined, id: number | string, dto: AssignWorkDto) {
    const numId = Number(id);
    const existing = await this.findOne(scopedCustomerId, numId);

    if (dto.assignedToId) {
      const targetEmpId = Number(dto.assignedToId);
      const perm = await this.workPermissionService.getAllowedActivityTypesForEmployee(targetEmpId, existing.customerId);
      const normalizedType = normalizeActivityType(existing);
      if (!perm.isFullAccess && !perm.allowedTypes.has(normalizedType)) {
        throw new BadRequestException(
          `Cannot assign activity '${existing.title || normalizedType}' to employee #${targetEmpId}. Their role '${perm.role}' does not support '${normalizedType}'.`,
        );
      }
    }
    if (dto.editorId) {
      const targetEditorId = Number(dto.editorId);
      const perm = await this.workPermissionService.getAllowedActivityTypesForEmployee(targetEditorId, existing.customerId);
      if (!perm.isFullAccess && !perm.allowedTypes.has('REEL_EDIT')) {
        throw new BadRequestException(
          `Cannot assign editor role to employee #${targetEditorId}. Their role '${perm.role}' does not support Video Editing.`,
        );
      }
    }

    const updateData: any = {};
    if (dto.assignedToId !== undefined) {
      updateData.assignedToId = dto.assignedToId ? Number(dto.assignedToId) : null;
    }
    if (dto.editorId !== undefined) {
      updateData.editorId = dto.editorId ? Number(dto.editorId) : null;
    }
    if (dto.teamId !== undefined) {
      updateData.teamId = dto.teamId ? Number(dto.teamId) : null;
    }

    if (existing.status === WorkStatus.SCHEDULED && (dto.assignedToId || dto.editorId)) {
      updateData.status = WorkStatus.ASSIGNED;
    }

    const previousAssignee = existing.assignedToId != null ? Number(existing.assignedToId) : null;
    const updated = await this.prisma.work.update({
      where: { id: numId },
      data: updateData,
      include: {
        customer: true,
        assignedTo: true,
        editor: true,
        team: true,
      },
    });

    if (dto.assignedToId !== undefined) {
      const nextAssignee = updated.assignedToId != null ? Number(updated.assignedToId) : null;
      await this.prisma.workTask.updateMany({
        where: {
          workId: numId,
          OR: [
            ...(previousAssignee ? [{ assignedToId: previousAssignee }] : []),
            { assignedToId: null },
          ],
          NOT: {
            title: { contains: 'Edit', mode: 'insensitive' },
          },
        },
        data: { assignedToId: nextAssignee },
      });
      if (
        nextAssignee &&
        nextAssignee !== previousAssignee &&
        this.notificationService?.sendWorkAssignmentNotification
      ) {
        this.notificationService
          .sendWorkAssignmentNotification(nextAssignee, updated, previousAssignee != null)
          .catch((err: any) => {
            this.logger.warn(`Failed to dispatch work assignment notification: ${err?.message}`);
          });
      }
    }

    if (dto.editorId !== undefined) {
      const nextEditor = updated.editorId != null ? Number(updated.editorId) : null;
      await this.prisma.workTask.updateMany({
        where: {
          workId: numId,
          OR: [
            { stepOrder: 2 },
            { title: { contains: 'Edit', mode: 'insensitive' } },
          ],
        },
        data: { assignedToId: nextEditor },
      });
      if (
        nextEditor &&
        this.notificationService?.sendWorkAssignmentNotification
      ) {
        this.notificationService
          .sendWorkAssignmentNotification(nextEditor, updated, false)
          .catch((err: any) => {
            this.logger.warn(`Failed to dispatch editor assignment notification: ${err?.message}`);
          });
      }
    }

    return {
      success: true,
      message: 'Staff successfully assigned to schedule.',
      work: updated,
    };
  }

  /**
   * Cancel Schedule & Release Reserved Quota
   */
  async cancelWork(scopedCustomerId: number | string | undefined, id: number | string) {
    const numId = Number(id);
    const existing = await this.findOne(scopedCustomerId, numId);

    if (existing.status === WorkStatus.CANCELLED) {
      return { success: true, message: 'Work already cancelled.', work: existing };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.work.update({
        where: { id: numId },
        data: { status: WorkStatus.CANCELLED },
        include: {
          customer: true,
          entitlement: true,
        },
      });

      // Release reserved quota if it was not already completed
      if (existing.status !== WorkStatus.COMPLETED && existing.entitlementId) {
        await tx.planEntitlement.update({
          where: { id: existing.entitlementId },
          data: {
            scheduledQty: { decrement: 1 },
          },
        });
      }

      return {
        success: true,
        message: 'Schedule cancelled and plan quota reservation released.',
        work: updated,
      };
    });

    this.emitRealtimeScheduleEvent(existing.customerId, 'PLAN_SCHEDULE_DELETED', {
      scheduleId: existing.id,
      planId: existing.subscriptionId,
    });

    if (this.notificationService && existing.assignedToId) {
      this.notificationService
        .sendTaskRescheduledNotification({
          customerId: existing.customerId,
          employeeId: existing.assignedToId,
          workId: existing.id,
          taskName: existing.title || 'Task',
          newDate: existing.scheduledDate,
          newTime: existing.scheduledTime,
          previousDate: existing.scheduledDate ? new Date(existing.scheduledDate).toISOString().split('T')[0] : '',
          previousTime: existing.scheduledTime,
          customerName: existing.customer?.companyName || existing.customer?.name || null,
          cancelled: true,
        })
        .catch((err) => {
          this.logger.warn(`Failed to dispatch schedule cancellation: ${err?.message}`);
        });
    }

    return result;
  }

  /**
   * Calendar query returning database-backed schedules
   */
  async getCalendar(
    scopedCustomerId?: number | string,
    query: {
      date?: string;
      dateFrom?: string;
      dateTo?: string;
      month?: number;
      year?: number;
      employeeId?: number | string;
      status?: WorkStatus;
    } = {},
  ) {
    const startTime = Date.now();

    // JIT task auto carry-forward check (at most once every 60 seconds)
    if (process.env.NODE_ENV !== 'test' && Date.now() - this.lastCarryForwardRunMs > 60000) {
      this.lastCarryForwardRunMs = Date.now();
      await this.autoCarryForwardIncompleteWorks().catch((err) => {
        this.logger.warn(`JIT carry-forward in getCalendar warning: ${err?.message}`);
      });
    }

    const where: any = {};
    let numCustomerId: number | undefined;

    if (scopedCustomerId !== undefined && scopedCustomerId !== null && String(scopedCustomerId).trim() !== '') {
      numCustomerId = this.resolveCustomerId(scopedCustomerId);
      if (!numCustomerId) {
        this.logger.log(`[CALENDAR_INVALID_CUSTOMER] scopedCustomerId: ${scopedCustomerId} is invalid. Returning 0 schedules.`);
        return [];
      }

      // Strictly scope to this customer's foreign key
      where.customerId = numCustomerId;
    }

    let activeSubForCustomer: any = null;
    if (numCustomerId) {
      if (this.prisma.customerSubscription?.findFirst) {
        activeSubForCustomer = await this.prisma.customerSubscription.findFirst({
          where: { customerId: numCustomerId, deletedAt: null, status: SubscriptionStatus.ACTIVE },
          orderBy: { createdAt: 'desc' },
          include: { plan: true },
        });

        // Strict Active Plan Rule:
        // If customer has no active subscription, return 0 schedules
        if (!activeSubForCustomer) {
          this.logger.log(
            `[CALENDAR_NO_ACTIVE_SUB] customerId: CUST-${numCustomerId} has no active plan. Returning 0 schedules.`,
          );
          return [];
        }

        where.subscriptionId = activeSubForCustomer.id;

        if (this.prisma.work?.count) {
          const subWorkCount = await this.prisma.work.count({
            where: {
              customerId: numCustomerId,
              subscriptionId: activeSubForCustomer.id,
              status: { not: WorkStatus.CANCELLED },
            },
          });
          if (subWorkCount === 0) {
            try {
              await this.generatePlanSchedules(numCustomerId, activeSubForCustomer.id);
            } catch (e: any) {
              this.logger.warn(`Schedule generation on calendar query: ${e?.message}`);
            }
          }
        }
      }
    }

    if (query.employeeId && !isNaN(Number(query.employeeId))) {
      where.OR = [
        { assignedToId: Number(query.employeeId) },
        { editorId: Number(query.employeeId) },
      ];
    }

    if (query.status) where.status = query.status;

    let targetDateStr: string | undefined;
    let targetYear: number | undefined;
    let targetMonth: number | undefined;
    let targetDay: number | undefined;

    if (query.date) {
      targetDateStr = query.date.trim();
      const parts = targetDateStr.split('-').map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        const [y, m, day] = parts;
        targetYear = y;
        targetMonth = m;
        targetDay = day;
        // Expand query window by ±24 hours to ensure capturing any timezone-stored records
        const startWindow = new Date(Date.UTC(y, m - 1, day - 1, 0, 0, 0, 0));
        const endWindow = new Date(Date.UTC(y, m - 1, day + 1, 23, 59, 59, 999));
        where.scheduledDate = { gte: startWindow, lte: endWindow };
      } else {
        const d = new Date(query.date);
        if (!isNaN(d.getTime())) {
          targetYear = d.getFullYear();
          targetMonth = d.getMonth() + 1;
          targetDay = d.getDate();
          const startWindow = new Date(d.getTime() - 24 * 60 * 60 * 1000);
          const endWindow = new Date(d.getTime() + 24 * 60 * 60 * 1000);
          where.scheduledDate = { gte: startWindow, lte: endWindow };
        }
      }
    } else if (query.month && query.year) {
      const startOfMonth = new Date(Date.UTC(query.year, query.month - 1, 1, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999));
      where.scheduledDate = { gte: startOfMonth, lte: endOfMonth };
    } else if (query.dateFrom || query.dateTo || (query as any).startDate || (query as any).endDate) {
      where.scheduledDate = {};
      const from = query.dateFrom || (query as any).startDate;
      const to = query.dateTo || (query as any).endDate;
      if (from) where.scheduledDate.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.scheduledDate.lte = toDate;
      }
    }

    this.logger.log(
      `[CALENDAR_QUERY] authenticatedCustomerId: CUST-${numCustomerId || scopedCustomerId} date: ${query.date || 'ALL'}`,
    );

    const queryStartTime = Date.now();
    const items = await this.prisma.work.findMany({
      where,
      orderBy: { scheduledDate: 'asc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            state: true,
            assignedEmployeeId: true,
            createdByEmployeeRel: { select: { id: true, firstName: true, lastName: true } },
            originLead: {
              select: {
              },
            },
            assignedTeam: {
              select: {
                id: true,
                customerId: true,
                name: true,
                leaderId: true,
                members: { select: { employeeId: true } },
              },
            },
          },
        },
        team: {
          select: {
            id: true,
            customerId: true,
            name: true,
            leaderId: true,
            members: { select: { employeeId: true } },
          },
        },
        assignedTo: {
          select: {
            id: true,
            customerId: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: {
              select: {
                userRoles: {
                  select: { role: { select: { type: true, name: true } } },
                },
              },
            },
          },
        },
        editor: {
          select: {
            id: true,
            customerId: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: {
              select: {
                userRoles: {
                  select: { role: { select: { type: true, name: true } } },
                },
              },
            },
          },
        },
        tasks: {
          select: {
            assignedToId: true,
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                department: { select: { name: true } },
                designation: { select: { name: true } },
                user: {
                  select: {
                    userRoles: {
                      select: { role: { select: { type: true, name: true } } },
                    },
                  },
                },
              },
            },
          },
        },
        entitlement: { select: { serviceName: true } },
        subscription: {
          select: {
            id: true,
            plan: { select: { name: true } },
          },
        },
      },
    });
    const queryEndTime = Date.now();

    this.logger.log(
      `[WORKS_CALENDAR_DB_DEBUG]\ncustomerId: ${numCustomerId || scopedCustomerId || 'ALL'}\ndate: ${query.date || 'ALL'}\nqueryStart: ${new Date(queryStartTime).toISOString()}\nqueryEnd: ${new Date(queryEndTime).toISOString()}\ndurationMs: ${queryEndTime - queryStartTime}\nrecordCount: ${items.length}`,
    );

    // Date-only precision filtering to strictly match target day without timezone shifts
    const filteredItems = (targetYear && targetMonth && targetDay)
      ? items.filter((w) => {
          const key = this.scheduleDateKey(w.scheduledDate);
          if (!key) return false;
          const [y, m, d] = key.split('-').map(Number);
          return y === targetYear && m === targetMonth && d === targetDay;
        })
      : items;

    let totalPaidForSub = 0;
    let isFullyPaid = true;
    let isFirstInstallmentPaid = true;
    let unlockThresholdDate: Date | null = null;

    if (numCustomerId && activeSubForCustomer) {
      const payments = this.prisma.paymentHistory?.findMany
        ? await this.prisma.paymentHistory.findMany({
            where: { customerId: numCustomerId, status: 'SUCCESS' },
          })
        : [];
      totalPaidForSub = Array.isArray(payments)
        ? payments.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0)
        : 0;
      const planBasePrice = Number(activeSubForCustomer.plan?.monthlyPrice || 0);
      const planTotalWithTax = Math.round(planBasePrice * 1.18);

      isFullyPaid = totalPaidForSub >= planTotalWithTax;
      isFirstInstallmentPaid = activeSubForCustomer.status === SubscriptionStatus.ACTIVE || totalPaidForSub > 0;

      const subStartDate = new Date(activeSubForCustomer.startDate);
      unlockThresholdDate = new Date(subStartDate.getTime() + 15 * 24 * 60 * 60 * 1000);
    }

    const result = filteredItems.map((w) => {
      const purchaseRef = w.subscriptionId
        ? `PUR-${String(w.subscriptionId).padStart(3, '0')}`
        : (w.subscription?.id ? `PUR-${String(w.subscription.id).padStart(3, '0')}` : `PUR-${String(w.customerId).padStart(3, '0')}`);
      const startTime = w.scheduledTime || '10:00 AM';
      const endTime = '11:00 AM';
      const prodName = w.entitlement?.serviceName || w.title || w.workType;
      const planName = w.subscription?.plan?.name || (activeSubForCustomer?.plan?.name ?? 'Active Plan');

      const schedDate = w.scheduledDate ? new Date(w.scheduledDate) : new Date();
      let isLocked = false;
      let lockMessage: string | undefined;

      if (numCustomerId && activeSubForCustomer) {
        if (!isFirstInstallmentPaid) {
          isLocked = true;
          lockMessage = 'Your schedule will be available after the 50% advance payment is received.';
        } else if (!isFullyPaid && unlockThresholdDate && schedDate > unlockThresholdDate) {
          isLocked = true;
          lockMessage = 'The second installation schedule will be available after the remaining 50% second installment is completed.';
        }
      }
      const isSubExpired = activeSubForCustomer?.endDate ? new Date() > new Date(activeSubForCustomer.endDate) : false;
      const statusStr = (w.status || '').toString().toUpperCase();
      const canReschedule = !isLocked && (statusStr === 'SCHEDULED' || statusStr === 'PENDING') && !isSubExpired;
      const canRequestRework = !isLocked && (statusStr === 'COMPLETED' || statusStr === 'APPROVED' || statusStr === 'DONE');
      let reworkActionLabel = 'Request Rework';
      const titleLower = (w.title || '').toLowerCase();
      if (titleLower.includes('shoot')) reworkActionLabel = 'Request Re-shoot';
      else if (titleLower.includes('edit')) reworkActionLabel = 'Request Re-edit';
      else if (titleLower.includes('design')) reworkActionLabel = 'Request Re-design';
      else if (titleLower.includes('post') || titleLower.includes('publish')) reworkActionLabel = 'Request Re-post';

      const schedDateVal = this.scheduleDateKey(w.scheduledDate);

      const originalScheduleMatch = (w.notes || '').match(/\[ORIGINAL_SCHEDULE:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\]/);
      const originalScheduledDate = originalScheduleMatch ? originalScheduleMatch[1] : null;
      const isCarriedForward = Boolean(
        originalScheduledDate && (schedDateVal ? originalScheduledDate !== schedDateVal : true),
      );
      let carryForwardNote: string | null = null;
      if (isCarriedForward && originalScheduledDate) {
        const parts = originalScheduledDate.split('-').map(Number);
        if (parts.length === 3 && !parts.some(isNaN)) {
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          carryForwardNote = `Originally scheduled: ${String(parts[2]).padStart(2, '0')} ${months[parts[1] - 1]} ${parts[0]}`;
        } else {
          carryForwardNote = `Originally scheduled: ${originalScheduledDate}`;
        }
      }

      const normalizedType = normalizeActivityType(w);
      const isEditing = ['VIDEO_EDITING', 'EDITING'].includes(w.workType);
      const actualAssignee = isEditing ? w.editor ?? w.assignedTo : w.assignedTo;
      const workTeam = w.team ?? w.customer?.assignedTeam;
      const member = actualAssignee && workTeam && (
        workTeam.members?.some((entry) => entry.employeeId === actualAssignee.id) ||
        workTeam.leaderId === actualAssignee.id
      );
      const sameTenant = actualAssignee?.customerId != null &&
        workTeam?.customerId != null && actualAssignee.customerId === workTeam.customerId;
      const assignmentTeamMismatch = Boolean(actualAssignee && workTeam && !(member && sameTenant));
      const verifiedTeam = !actualAssignee || (member && sameTenant) ? workTeam : null;
      if (assignmentTeamMismatch) this.logger.warn(
        `[CALENDAR_ASSIGNMENT_TEAM_MISMATCH] workId=${w.id} customerId=${w.customerId} employeeId=${actualAssignee.id} teamId=${workTeam.id}`,
      );

      return {
        id: String(w.id),
        activityId: String(w.id),
        customerId: String(w.customerId),
        customerName: w.customer?.name || 'Customer',
        purchaseId: purchaseRef,
        productName: isLocked ? 'Schedule Locked' : prodName,
        serviceName: isLocked ? 'Schedule Locked' : prodName,
        planName: planName,
        title: isLocked ? 'Schedule Locked' : w.title,
        scheduledDate: schedDateVal,
        scheduledAt: w.scheduledDate,
        scheduledTime: startTime,
        originalScheduledDate,
        isCarriedForward,
        carryForwardNote,
        date: w.scheduledDate,
        scheduleDate: w.scheduledDate,
        time: startTime,
        startTime: startTime,
        endTime: endTime,
        type: isLocked ? 'LOCKED' : normalizedType,
        activityType: isLocked ? 'LOCKED' : normalizedType,
        workType: w.workType,
        status: isLocked ? 'LOCKED' : w.status,
        location: [w.customer?.address, w.customer?.city, w.customer?.state].filter(Boolean).join(', ') || null,
        canReschedule,
        canRequestRework,
        reworkActionLabel,
        isLocked,
        lockMessage,
        editorName: isLocked ? null : (w.editor ? `${w.editor.firstName || ''} ${w.editor.lastName || ''}`.trim() || null : null),
        assignedToId: w.assignedToId ?? null,
        editorId: w.editorId ?? null,
        assignedEmployee: isLocked ? null : getEmployeeName(actualAssignee),
        assignedToName: isLocked ? null : getEmployeeName(actualAssignee),
        team: verifiedTeam?.name ?? null,
        teamId: verifiedTeam?.id ?? null,
        assignedTeam: workTeam?.name ?? null,
        assignedTeamId: workTeam?.id ?? null,
        assignmentTeamMismatch,
        notes: isLocked
          ? (lockMessage || 'Complete the remaining 50% payment to unlock your second installation schedule.')
          : (w.description || w.notes || `${w.title} deliverable`),
        outputUrl: isLocked ? null : w.outputUrl,
        feedback: isLocked ? null : w.feedback,
        revisionCount: isLocked ? 0 : w.revisionCount,
      };
    });

    // Detailed debug logs for calendar verification
    this.logger.log(`[CALENDAR_DATE_DEBUG]
requestedDate: ${query.date || 'ALL'}
returnedSchedules: ${result.length}`);

    this.logger.log(`[CALENDAR_DEBUG]
authenticatedCustomerId: ${numCustomerId ? `CUST-${numCustomerId}` : (scopedCustomerId || 'NONE')}
requestedDate: ${query.date || 'ALL'}
activePlanId: ${activeSubForCustomer?.planId ?? 'NONE'}
subscriptionId: ${activeSubForCustomer?.id ?? 'NONE'}
returnedSchedules: ${result.length}`);

    this.logger.log(`[CALENDAR_DEBUG]
DB schedules before filtering: ${items.length}`);

    this.logger.log(`[CALENDAR_DEBUG]
DB schedules after customer filter: ${numCustomerId ? items.filter(i => i.customerId === numCustomerId).length : items.length}`);

    this.logger.log(`[CALENDAR_DEBUG]
DB schedules after active-plan filter: ${activeSubForCustomer ? items.filter(i => i.subscriptionId === activeSubForCustomer.id).length : items.length}`);

    this.logger.log(`[CALENDAR_DEBUG]
DB schedules after date filter: ${filteredItems.length}`);

    this.logger.log(`[CALENDAR_DEBUG]
final response count: ${result.length}`);

    for (const item of result) {
      this.logger.log(`[CALENDAR_SCHEDULE_ITEM]
scheduleId: ${item.id}
customerId: CUST-${item.customerId}
planId: ${activeSubForCustomer?.planId ?? item.planName}
subscriptionId: ${item.purchaseId}
activityId: ${item.activityId}
activityType: ${item.activityType}
scheduledDate: ${item.scheduledDate}
status: ${item.status}`);
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `[CALENDAR_RESULT] count: ${result.length}`,
    );
    this.logger.log(
      `[API_PERFORMANCE] GET /works/calendar customerId=${scopedCustomerId} DB duration=${duration}ms total=${duration}ms`,
    );
    return result;
  }

  /**
   * Team members whose designation or team role matches this activity.
   * Keyword rules are the existing production distribution rules.
   */
  private membersMatchingActivity(
    act: { workType?: string; title?: string; description?: string; serviceName?: string },
    members: Array<{
      employeeId: number;
      role?: string;
      employee?: {
        id?: number;
        firstName?: string;
        lastName?: string;
        designation?: { name: string } | null;
        department?: { name: string } | null;
      };
    }>,
  ) {
    const normalizedType = normalizeActivityType(act);
    const memberMatches = (m: any, keywords: string[]) => {
      const desName = (m.employee?.designation?.name || '').toLowerCase();
      const deptName = (m.employee?.department?.name || '').toLowerCase();
      const role = (m.role || '').toLowerCase();
      const combined = `${desName} ${deptName} ${role}`;
      return keywords.some((k) => combined.includes(k));
    };

    if (normalizedType === 'REEL_EDIT' || normalizedType === 'VIDEO_EDITING') {
      // "video" alone also matches Videographer and would take the edit away
      // from the Video Editor. Editor / editing are the existing editor titles.
      return members.filter((m) => memberMatches(m, ['editor', 'video edit', 'editing']));
    }
    if (normalizedType === 'POST_DESIGN') {
      return members.filter((m) => memberMatches(m, ['graphic', 'design', 'designer', 'artist', 'creative']));
    }
    if (normalizedType === 'STORY_DESIGN') {
      return members.filter((m) => memberMatches(m, ['graphic', 'design', 'designer', 'story', 'creative']));
    }
    if (normalizedType === 'REEL_SHOOT') {
      return members.filter((m) => memberMatches(m, ['photo', 'camera', 'shoot', 'videographer', 'photographer']));
    }
    if (normalizedType === 'REEL_POST' || normalizedType === 'STORY_POST') {
      return members.filter((m) => memberMatches(m, ['social', 'media', 'manager', 'marketing', 'content', 'executive']));
    }
    if (normalizedType === 'INFLUENCER_PROMO') {
      return members.filter((m) => memberMatches(m, ['influencer', 'promo', 'pr', 'marketing']));
    }
    return [];
  }

  /**
   * Helper to resolve the best-matching employee ID from a team's member list
   * based on activity workType, title, description, or serviceName.
   */
  resolveTeamMemberForActivity(
    act: { workType?: string; title?: string; description?: string; serviceName?: string },
    members: Array<{
      employeeId: number;
      role?: string;
      employee?: {
        id: number;
        firstName?: string;
        lastName?: string;
        designation?: { name: string } | null;
        department?: { name: string } | null;
      };
    }>,
    leaderId?: number | null,
    roundRobinIndex: number = 0,
    options?: { roleMatchOnly?: boolean },
  ): number | null {
    if (!members || members.length === 0) {
      return leaderId || null;
    }

    const eligibleMembers = this.membersMatchingActivity(act, members);

    if (eligibleMembers.length > 0) {
      const chosen = eligibleMembers[roundRobinIndex % eligibleMembers.length];
      return chosen.employeeId;
    }

    if (options?.roleMatchOnly) return null;

    // Fallback: Round-robin among all team members or leader
    if (members.length > 0) {
      const chosen = members[roundRobinIndex % members.length];
      return chosen.employeeId;
    }

    return leaderId || null;
  }

  private isPlatformAdmin(person?: {
    firstName?: string | null;
    lastName?: string | null;
    department?: { name?: string | null } | null;
    designation?: { name?: string | null } | null;
    user?: {
      userRoles?: Array<{
        role?: { type?: string; name?: string } | null;
      }> | null;
    } | null;
  } | null): boolean {
    if (!person) return false;
    const adminRoleTypes = new Set(['SUPER_ADMIN', 'CUSTOMER_ADMIN', 'TENANT_ADMIN', 'ADMIN']);
    const first = String(person?.firstName || '').trim().toUpperCase();
    const last = String(person?.lastName || '').trim().toUpperCase();
    const fullName = `${first} ${last}`.trim().replace(/\s+/g, ' ');
    if (
      fullName === 'SUPER ADMIN' ||
      fullName === 'COMPANY ADMIN' ||
      fullName === 'SYSTEM ADMIN' ||
      fullName === 'TENANT ADMIN' ||
      fullName === 'ADMIN' ||
      first === 'SUPER ADMIN' ||
      last === 'SUPER ADMIN' ||
      /\bSUPER[\s_]*ADMIN\b|\bCOMPANY[\s_]*ADMIN\b|\bTENANT[\s_]*ADMIN\b|\bSYSTEM[\s_]*ADMIN\b/i.test(fullName)
    ) {
      return true;
    }
    const desName = String(person?.designation?.name || '').toUpperCase();
    const depName = String(person?.department?.name || '').toUpperCase();
    const roleLabel = `${desName} ${depName}`.trim();
    if (/SUPER[\s_]*ADMIN|COMPANY[\s_]*ADMIN|TENANT[\s_]*ADMIN|\bADMIN\b/i.test(roleLabel)) {
      return true;
    }
    const userRoles = person?.user?.userRoles || [];
    if (
      userRoles.some((ur: any) => {
        const rType = String(ur?.role?.type || '').toUpperCase();
        const rName = String(ur?.role?.name || '').toUpperCase();
        return (
          adminRoleTypes.has(rType) ||
          /SUPER[\s_]*ADMIN|COMPANY[\s_]*ADMIN|TENANT[\s_]*ADMIN|\bADMIN\b/i.test(rName)
        );
      })
    ) {
      return true;
    }
    return false;
  }

  private isSalesOrBpoEmployee(employee: any): boolean {
    return /BPO|SALES|TELECALL|TELESELL|CALL CENTER|CALL CENTRE/i.test(
      `${employee?.department?.name || ''} ${employee?.designation?.name || ''} ${(employee?.user?.userRoles || []).map((entry: any) => entry.role?.name || '').join(' ')}`,
    );
  }

  private async eligibleProductionMemberIds(
    act: { workType?: string; title?: string; description?: string; serviceName?: string },
    members: Array<{
      employeeId: number;
      employee?: {
        id: number;
        customerId?: number | null;
        status?: string | null;
        designation?: { name?: string | null } | null;
        department?: { name?: string | null } | null;
        user?: { userRoles?: Array<{ role?: { type?: string; name?: string } | null }> | null } | null;
      } | null;
    }>,
    teamCustomerId?: number | null,
  ): Promise<number[]> {
    const normalizedType = normalizeActivityType(act);
    const activeMembers = (members || []).filter((member) => {
      const employeeId = Number(member.employeeId || member.employee?.id);
      if (!Number.isInteger(employeeId) || employeeId <= 0) return false;
      const status = String(member.employee?.status || 'ACTIVE').toUpperCase();
      if (
        status === 'INACTIVE' ||
        this.isSalesOrBpoEmployee(member.employee) ||
        this.isPlatformAdmin(member.employee)
      ) {
        return false;
      }
      if (
        teamCustomerId &&
        member.employee?.customerId &&
        Number(member.employee.customerId) !== Number(teamCustomerId)
      ) {
        return false;
      }
      const designation = String(member.employee?.designation?.name || '').toUpperCase();
      if (
        designation.includes('PRODUCTION MANAGER') ||
        designation.includes('PRODUCTION_MANAGER') ||
        designation.includes('PROD MGR') ||
        designation.includes('PRODUCTION LEAD')
      ) {
        return false;
      }
      return true;
    });
    const designationMatchIds = new Set(
      this.membersMatchingActivity(act, activeMembers as any).map((member) =>
        Number(member.employeeId || member.employee?.id),
      ),
    );
    const eligible: number[] = [];

    for (const member of activeMembers) {
      const employeeId = Number(member.employeeId || member.employee?.id);
      try {
        const permission = this.workPermissionService?.getAllowedActivityTypesForEmployee
          ? await this.workPermissionService.getAllowedActivityTypesForEmployee(
              employeeId,
              member.employee?.customerId || teamCustomerId || undefined,
            )
          : null;
        if (permission?.isFullAccess || permission?.isProductionManager) continue;
        if (designationMatchIds.has(employeeId) || permission?.allowedTypes?.has(normalizedType)) {
          eligible.push(employeeId);
        }
      } catch (err: any) {
        if (designationMatchIds.has(employeeId)) eligible.push(employeeId);
        this.logger.warn(
          `Unable to resolve work eligibility for employee ${employeeId}: ${err?.message}`,
        );
      }
    }

    return eligible;
  }

  /**
   * Check if a team is purely a BPO-telecalling team and not a production team.
   */
  private isBpoOnlyTeam(name?: string | null, description?: string | null): boolean {
    const label = `${name || ''} ${description || ''}`.toUpperCase();
    return label.includes('BPO') && !label.includes('PRODUCTION');
  }

  /**
   * Active production teams for this employee, scoped to their company.
   * Inactive employees and BPO-only teams are excluded.
   */
  private async activeProductionTeamIdsForEmployee(
    employeeId: number,
    tenantCustomerId?: number | null,
    candidateIds?: number[],
    strictTenant = false,
  ): Promise<number[]> {
    const findEmp = this.prisma.employee?.findFirst ?? this.prisma.employee?.findUnique;
    if (
      typeof findEmp !== 'function' ||
      typeof this.prisma.teamMember?.findMany !== 'function' ||
      typeof this.prisma.team?.findMany !== 'function'
    ) {
      return [];
    }

    const employee = typeof this.prisma.employee?.findFirst === 'function'
      ? await this.prisma.employee.findFirst({
          where: { id: employeeId },
          select: { id: true, userId: true, customerId: true, status: true },
        })
      : await this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, userId: true, customerId: true, status: true },
        });
    if (!employee || String(employee.status || '').toUpperCase() === 'INACTIVE') return [];

    const tenantId = Number(tenantCustomerId || employee.customerId);
    const empIds = candidateIds && candidateIds.length > 0 ? [...candidateIds] : [employeeId];
    if (employee.userId && Number(employee.userId) > 0 && !empIds.includes(Number(employee.userId))) {
      empIds.push(Number(employee.userId));
    }

    const [memberships, ledTeams] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: {
          employeeId: { in: empIds },
          team: { isActive: true },
        },
        select: {
          teamId: true,
          team: { select: { name: true, description: true, customerId: true, isActive: true } },
        },
      }),
      this.prisma.team.findMany({
        where: { leaderId: { in: empIds }, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          customerId: true,
          leader: { select: { status: true } },
        },
      }),
    ]);

    const rows = new Map<number, number>();
    for (const row of memberships) {
      if (row.team?.isActive === false) continue;
      if (this.isBpoOnlyTeam(row.team?.name, row.team?.description)) continue;
      rows.set(row.teamId, Number(row.team?.customerId));
    }
    for (const team of ledTeams) {
      if (String(team.leader?.status || '').toUpperCase() === 'INACTIVE') continue;
      if (this.isBpoOnlyTeam(team.name, team.description)) continue;
      rows.set(team.id, Number(team.customerId));
    }

    if (rows.size === 0) return [];

    const sameCompany = Array.from(rows.entries()).filter(([, companyId]) =>
      Number.isInteger(tenantId) && tenantId > 0 ? companyId === tenantId : true,
    );
    if (Number.isInteger(tenantId) && tenantId > 0) {
      return sameCompany.map(([teamId]) => teamId);
    }

    return Array.from(rows.keys());
  }

  /**
   * Teams this employee belongs to or leads. Customer allotment uses
   * Customer.assignedTeamId, so BPO membership is included here. Production-only
   * helpers keep their own BPO exclusion.
   */
  private async employeeTeamIds(
    employeeId: number,
    tenantCustomerId?: number | null,
    candidateIds?: number[],
    strictTenant = false,
  ): Promise<number[]> {
    if (
      typeof this.prisma.teamMember?.findMany !== 'function' ||
      typeof this.prisma.team?.findMany !== 'function'
    ) {
      return [];
    }
    const tenantId = Number(tenantCustomerId);
    const empIds = candidateIds && candidateIds.length > 0 ? candidateIds : [employeeId];
    const [memberships, ledTeams] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { employeeId: { in: empIds }, team: { isActive: true } },
        select: { teamId: true, team: { select: { customerId: true, isActive: true } } },
      }),
      this.prisma.team.findMany({
        where: { leaderId: { in: empIds }, isActive: true },
        select: { id: true, customerId: true },
      }),
    ]);
    const rows = new Map<number, number>();
    for (const row of memberships || []) {
      if (row.team?.isActive === false) continue;
      rows.set(row.teamId, Number(row.team?.customerId));
    }
    for (const team of ledTeams || []) {
      rows.set(team.id, Number(team.customerId));
    }
    if (rows.size === 0) return [];

    const sameCompany = Array.from(rows.entries()).filter(([, companyId]) =>
      Number.isInteger(tenantId) && tenantId > 0 ? companyId === tenantId : true,
    );
    if (strictTenant || (Number.isInteger(tenantId) && tenantId > 0)) {
      return sameCompany.map(([teamId]) => teamId);
    }
    return Array.from(rows.keys());
  }

  /**
   * When the employee has no TeamMember row, the teams already stored on
   * their work still identify the production team whose customers they can view.
   */
  private async productionTeamIdsFromEmployeeWorks(
    employeeId: number,
    candidateIds?: number[],
  ): Promise<number[]> {
    if (typeof this.prisma.work?.findMany !== 'function') return [];
    const viewerIds = candidateIds && candidateIds.length > 0 ? candidateIds : [employeeId];

    const orConds: any[] = [
      { assignedToId: employeeId },
      { editorId: employeeId },
      { tasks: { some: { assignedToId: employeeId } } },
      { customer: { assignedEmployeeId: employeeId } },
    ];
    for (const cid of viewerIds) {
      if (cid !== employeeId) {
        orConds.push(
          { assignedToId: cid },
          { editorId: cid },
          { tasks: { some: { assignedToId: cid } } },
          { customer: { assignedEmployeeId: cid } },
        );
      }
    }

    const works = await this.prisma.work.findMany({
      where: {
        status: { not: WorkStatus.CANCELLED },
        OR: orConds,
      },
      select: {
        team: { select: { id: true, name: true, description: true, isActive: true } },
        customer: {
          select: {
            assignedTeam: { select: { id: true, name: true, description: true, isActive: true } },
          },
        },
      },
    });
    const ids = new Set<number>();
    const keep = (team?: { id?: number; name?: string | null; description?: string | null; isActive?: boolean | null } | null) => {
      if (!team?.id || team.isActive === false) return;
      if (this.isBpoOnlyTeam(team.name, team.description)) return;
      ids.add(team.id);
    };
    for (const work of works) {
      keep(work.team);
      keep(work.customer?.assignedTeam);
    }
    return Array.from(ids);
  }

  private async customerIdsAssignedToTeams(teamIds: number[]): Promise<number[]> {
    if (teamIds.length === 0 || typeof this.prisma.customer?.findMany !== 'function') return [];
    try {
      const customers = await this.prisma.customer.findMany({
        where: {
          deletedAt: null,
          OR: [
            { assignedTeamId: { in: teamIds } },
            { assignedTeam: { id: { in: teamIds } } },
            { works: { some: { teamId: { in: teamIds }, status: { not: WorkStatus.CANCELLED } } } },
          ],
        },
        select: { id: true },
      });
      return customers.map((customer) => customer.id);
    } catch {
      const customers = await this.prisma.customer.findMany({
        where: {
          deletedAt: null,
          assignedTeamId: { in: teamIds },
        },
        select: { id: true },
      });
      return customers.map((customer) => customer.id);
    }
  }

  /**
   * Calendar day stored on the work row. Customer and employee calendars both
   * use this value so a task is not moved onto the date the user happens to open.
   */
  private scheduleDateKey(value: any): string | null {
    if (!value) return null;
    let parsed: Date;
    if (value instanceof Date) {
      parsed = value;
    } else {
      parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        const raw = String(value);
        const datePart = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
        return null;
      }
    }
    // Offset UTC to Indian Standard Time (+05:30) for consistent date matching
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(parsed.getTime() + istOffsetMs);
    return istDate.toISOString().split('T')[0];
  }

  /**
   * Assigned Staff is the employee stored on this work who belongs to the
   * production team. The lead owner, customer owner, and current viewer are
   * not used when they are not a member of that team.
   */
  private productionTaskAssignee(w: any): { id: number | null; name: string; teamName: string | null } {
    const team = w.team || w.customer?.assignedTeam || null;
    const teamName = team?.name || null;
    const memberIds = new Set<number>(
      (team?.members || [])
        .map((member: any) => Number(member.employeeId))
        .filter((id: number) => Number.isInteger(id) && id > 0),
    );
    const personName = (person?: { firstName?: string | null; lastName?: string | null } | null) =>
      `${person?.firstName || ''} ${person?.lastName || ''}`.trim();

    const isTaskAssignee = (person?: any, requireTeam = true) => {
      const id = Number(person?.id);
      if (!Number.isInteger(id) || id <= 0) return false;
      if (this.isPlatformAdmin(person) || this.isSalesOrBpoEmployee(person)) return false;
      if (requireTeam && memberIds.size > 0 && !memberIds.has(id)) return false;
      return true;
    };

    const candidates = [
      w.assignedTo,
      ...(w.tasks || []).map((task: any) => task.assignedTo),
      w.editor,
    ];
    const stored = candidates.find((person) => isTaskAssignee(person, true));
    if (stored) {
      return { id: Number(stored.id), name: personName(stored) || 'Not assigned', teamName };
    }
    return { id: null, name: 'Not assigned', teamName };
  }

  /**
   * Synchronize and assign all unassigned or team-less activities for a customer to the customer's assigned team.
   * Matches production activities using each active member's configured work permissions.
   */
  /** Reuse recorded production-team assignments; never guess a default team. */
  async resolveCustomerProductionTeam(customerId: number, txClient?: any): Promise<number | null> {
    const prisma = txClient?.customer?.findUnique ? txClient : this.prisma;
    if (typeof prisma?.customer?.findUnique !== 'function') return null;
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: { assignedTeam: true, originLead: { select: { customerId: true, assignedTeam: true } } },
    });
    if (!customer || customer.deletedAt) return null;
    const isProduction = (team: any) => team && team.isActive !== false &&
      !this.isBpoOnlyTeam(team.name, team.description);
    if (isProduction(customer.assignedTeam)) return customer.assignedTeam.id;

    const workPrisma = txClient?.work?.findMany ? txClient : this.prisma;
    const recordedTeams = typeof workPrisma?.work?.findMany === 'function'
      ? await workPrisma.work.findMany({
          where: { customerId, teamId: { not: null }, status: { not: WorkStatus.CANCELLED } },
          distinct: ['teamId'],
          select: { team: true },
        })
      : [];
    const tenantId = customer.originLead?.customerId || customer.assignedTeam?.customerId;
    const candidates = recordedTeams.map((work: any) => work.team).filter((team: any) =>
      isProduction(team) && (!tenantId || team.customerId === tenantId));
    const uniqueTeams = [...new Map(candidates.map((team: any) => [team.id, team])).values()] as any[];
    if (uniqueTeams.length === 1) {
      if (typeof prisma?.customer?.updateMany === 'function') {
        const updated = await prisma.customer.updateMany({
          where: { id: customerId, assignedTeamId: customer.assignedTeamId ?? null },
          data: { assignedTeamId: uniqueTeams[0].id },
        });
        if (updated.count !== 1) throw new BadRequestException('Customer team changed during assignment repair; retry with current data');
      }
      return uniqueTeams[0].id;
    }

    const teamPrisma = txClient?.team?.findUnique ? txClient : this.prisma;
    // Origin lead assignedTeam fallback (if lead had a production team specified):
    if (customer.originLead?.assignedTeam && typeof teamPrisma?.team?.findUnique === 'function') {
      const rawLeadTeam = customer.originLead.assignedTeam;
      const numLeadTeam = Number(rawLeadTeam);
      let leadTeamObj: any = null;
      if (!isNaN(numLeadTeam) && numLeadTeam > 0) {
        leadTeamObj = await teamPrisma.team.findUnique({ where: { id: numLeadTeam } });
      }
      if (!leadTeamObj && typeof teamPrisma?.team?.findFirst === 'function') {
        leadTeamObj = await teamPrisma.team.findFirst({
          where: { name: { equals: String(rawLeadTeam).trim(), mode: 'insensitive' }, isActive: true, ...(tenantId ? { customerId: tenantId } : {}) },
        });
      }
      if (isProduction(leadTeamObj) && (!tenantId || leadTeamObj.customerId === tenantId)) {
        if (typeof prisma?.customer?.updateMany === 'function') {
          const updated = await prisma.customer.updateMany({
            where: { id: customerId, assignedTeamId: customer.assignedTeamId ?? null },
            data: { assignedTeamId: leadTeamObj.id },
          });
          if (updated.count !== 1) throw new BadRequestException('Customer team changed during assignment repair');
        }
        return leadTeamObj.id;
      }
    }

    this.logger.warn(`[PRODUCTION_TEAM_MISSING] customerId=${customerId} leadId=${customer.leadId ?? 'none'} assignedTeamId=${customer.assignedTeamId ?? 'none'} recordedProductionTeams=${uniqueTeams.length}; assign a production team explicitly`);
    return null;
  }

  private async fillMissingWorkTaskAssignments(work: any, data: any, team: any, prisma: any): Promise<void> {
    for (const task of work.tasks || []) {
      if (task.assignedToId != null || task.status !== TaskStatus.PENDING) continue;
      const title = String(task.title || '').toLowerCase();
      const type = /edit|color|grad/.test(title) ? WorkType.EDITING
        : /upload|publish|social media/.test(title) ? WorkType.UPLOADING
        : /content|asset.*prep/.test(title) ? WorkType.CONTENT_WRITING
        : /shoot|camera/.test(title) ? WorkType.SHOOT : work.workType;
      const ids = await this.eligibleProductionMemberIds({ workType: type, title: task.title }, team.members, team.customerId);
      const owner = type === WorkType.EDITING ? data.editorId || work.editorId : data.assignedToId || work.assignedToId;
      const employeeId = ids.includes(owner) ? owner : ids[0];
      if (employeeId) await prisma.workTask.updateMany({
        where: { id: task.id, assignedToId: null, status: TaskStatus.PENDING },
        data: { assignedToId: employeeId },
      });
    }
  }

  async syncCustomerTeamWorkAssignments(
    customerId: number | string,
    teamId: number | string,
    txClient?: any,
    options?: { onlyMissing?: boolean },
  ): Promise<number> {
    const numCustomerId = Number(customerId);
    const numTeamId = Number(teamId);
    if (!numCustomerId || !numTeamId || isNaN(numCustomerId) || isNaN(numTeamId)) {
      return 0;
    }

    const prisma = txClient || this.prisma;

    const team = await prisma.team.findUnique({
      where: { id: numTeamId },
      include: {
        leader: { select: { id: true, firstName: true, lastName: true } },
        members: {
          include: {
            employee: {
              select: {
                id: true,
                customerId: true,
                status: true,
                firstName: true,
                lastName: true,
                designation: { select: { name: true } },
                department: { select: { name: true } },
                user: { select: { userRoles: { select: { role: { select: { name: true, type: true } } } } } },
              },
            },
          },
        },
      },
    });

    if (!team) {
      this.logger.warn(`syncCustomerTeamWorkAssignments: Team ${numTeamId} not found.`);
      return 0;
    }

    // Find all works for this customer that are not cancelled and need assignment or team update
    const unassignedWorks = await prisma.work.findMany({
      where: {
        customerId: numCustomerId,
        status: { not: WorkStatus.CANCELLED },
        OR: options?.onlyMissing ? [
          { assignedToId: null }, { editorId: null }, { teamId: null },
          { tasks: { some: { assignedToId: null, status: TaskStatus.PENDING } } },
        ] : [
          { assignedToId: null }, { teamId: null }, { teamId: { not: numTeamId } },
          { status: { in: [WorkStatus.SCHEDULED, WorkStatus.ASSIGNED] } },
        ],
      },
      orderBy: { id: 'asc' },
      include: { ...(options?.onlyMissing ? { tasks: true } : {}), assignedTo: { select: { department: true, designation: true, user: { select: { userRoles: { select: { role: { select: { name: true } } } } } } } } },
    });

    if (unassignedWorks.length === 0) {
      return 0;
    }

    const isBpoTeam = this.isBpoOnlyTeam(team.name, team.description);
    let roleAssignmentIndex = 0;

    let updatedCount = 0;
    for (const work of unassignedWorks) {
      if (options?.onlyMissing && work.teamId != null && work.teamId !== numTeamId) continue;
      const data: { teamId?: number; assignedToId?: number; editorId?: number; status?: WorkStatus } = {};
      if (work.teamId !== numTeamId) data.teamId = numTeamId;

      const eligibleMemberIds = !isBpoTeam
        ? await this.eligibleProductionMemberIds(work, team.members, team.customerId)
        : [];
      if (!isBpoTeam && (options?.onlyMissing ? work.assignedToId == null : !eligibleMemberIds.includes(Number(work.assignedToId)))) {
        const matchedEmployeeId = eligibleMemberIds.length > 0
          ? eligibleMemberIds[roleAssignmentIndex % eligibleMemberIds.length]
          : null;
        if (matchedEmployeeId) {
          data.assignedToId = matchedEmployeeId;
          if (work.status === WorkStatus.SCHEDULED) data.status = WorkStatus.ASSIGNED;
          roleAssignmentIndex++;
        }
      }

      const isReelOrVideo =
        work.workType === WorkType.REEL ||
        work.workType === WorkType.REELS_SHOOT ||
        work.workType === WorkType.EDITING ||
        work.workType === WorkType.VIDEO_EDITING ||
        (work.title && /reel|shoot|video|edit/i.test(work.title));
      if (!isBpoTeam && isReelOrVideo) {
        const editorIds = await this.eligibleProductionMemberIds(
          { workType: WorkType.EDITING, title: 'Video Editing' }, team.members, team.customerId,
        );
        if (editorIds.length > 0 && (options?.onlyMissing ? work.editorId == null : !editorIds.includes(Number(work.editorId)))) data.editorId = editorIds[0];
      }

      if (options?.onlyMissing && !isBpoTeam) await this.fillMissingWorkTaskAssignments(work, data, team, prisma);
      if (Object.keys(data).length === 0) continue;

      const previousAssigneeId = work.assignedToId;
      const previousPerson = work.assignedTo || (team.members || []).find((member: any) => member.employeeId === previousAssigneeId)?.employee;
      if (options?.onlyMissing && typeof prisma.work.updateMany === 'function') {
        const unchangedFields = Object.fromEntries(Object.keys(data).map((key) => [key, work[key] ?? null]));
        const updated = await prisma.work.updateMany({ where: { id: work.id, ...unchangedFields }, data });
        if (updated.count === 0) continue;
      } else {
        await prisma.work.update({ where: { id: work.id }, data });
      }

      if (!options?.onlyMissing && data.assignedToId && previousAssigneeId && (this.isSalesOrBpoEmployee(previousPerson) || this.isPlatformAdmin(previousPerson))) {
        // Correct only pending workflow steps owned by the misplaced BPO owner.
        // Editing steps use the eligible production editor; completed work is preserved.
        const editStep = { OR: ['edit', 'color', 'grade'].map((text) => ({ title: { contains: text, mode: 'insensitive' } })) };
        const editorId = data.editorId || work.editorId;
        if (editorId) {
          await prisma.workTask.updateMany({
            where: { workId: work.id, assignedToId: previousAssigneeId, status: TaskStatus.PENDING, AND: [editStep] },
            data: { assignedToId: editorId },
          });
        }
        await prisma.workTask.updateMany({
          where: { workId: work.id, assignedToId: previousAssigneeId, status: TaskStatus.PENDING, ...(editorId ? { NOT: editStep } : {}) },
          data: { assignedToId: data.assignedToId },
        });
      }

      if (data.assignedToId) {
        if (!options?.onlyMissing) await prisma.workTask.updateMany({
          where: { workId: work.id, assignedToId: null },
          data: { assignedToId: data.assignedToId },
        });
        if (this.notificationService?.sendWorkAssignmentNotification) {
          this.notificationService
            .sendWorkAssignmentNotification(data.assignedToId, { ...work, ...data }, false)
            .catch((err: any) => {
              this.logger.warn(`Failed to dispatch work assignment notification: ${err?.message}`);
            });
        }
      }

      updatedCount++;
    }

    this.logger.log(
      `[WORK_ASSIGNMENT_SYNC] Customer ${numCustomerId}: Synced ${updatedCount} works to Team ${numTeamId} (${team.name}).`,
    );

    return updatedCount;
  }

  /**
   * Get scheduled calendar events assigned to a specific employee.
   * Matches strictly by:
   * 1. Direct work assignment (assignedToId === employeeId || editorId === employeeId)
   * 2. User ID match (assignedToId === employee.userId || editorId === employee.userId)
   * 3. Subtask assignment (tasks.some.assignedToId === employeeId || tasks.some.assignedToId === employee.userId)
   * 4. Customer direct assignment (customer.assignedEmployeeId === employeeId && assignedToId === null)
   *
   * Strict Isolation: Team members do NOT see other team members' activities.
   *
   * Timezone Normalization:
   * Evaluates date queries against UTC, local server, and IST (UTC+05:30) to prevent 1-day shifts.
   */
  async getEmployeeCalendar(
    employeeId: number,
    query: {
      date?: string;
      dateFrom?: string;
      dateTo?: string;
      month?: number;
      year?: number;
      status?: WorkStatus | string;
      customerId?: number;
      employeeId?: number;
      teamId?: number;
      workType?: string;
      search?: string;
    } = {},
    options?: { allTenantCustomers?: boolean; assignedOnly?: boolean },
  ) {
    const startTime = Date.now();
    const numEmployeeId = Number(employeeId);
    if (!numEmployeeId || isNaN(numEmployeeId)) {
      return [];
    }

    // Resolve employee details for complete relationship mapping
    const empRecord = this.prisma.employee?.findUnique
      ? await this.prisma.employee.findUnique({
          where: { id: numEmployeeId },
          select: {
            id: true,
            userId: true,
            firstName: true,
            lastName: true,
            customerId: true,
            employeeCode: true,
            status: true,
            designation: { select: { name: true } },
            department: { select: { name: true } },
          },
        })
      : (this.prisma.employee?.findFirst
          ? await this.prisma.employee.findFirst({
              where: { id: numEmployeeId },
              select: {
            id: true,
            userId: true,
            firstName: true,
            lastName: true,
            customerId: true,
            employeeCode: true,
            status: true,
            designation: { select: { name: true } },
            department: { select: { name: true } },
          },
            })
          : null);

    if (options?.assignedOnly && (!empRecord || String(empRecord.status).toUpperCase() === 'INACTIVE')) {
      this.logger.log(`[EMPLOYEE_CALENDAR_DEBUG] resolvedEmployeeId=${numEmployeeId} exclusion=employeeMissingOrInactive finalCount=0`);
      return [];
    }

    // Resolve employee role and allowed activity types for role-based visibility
    let empRole = 'UNKNOWN';
    let allowedTypes = new Set<string>();
    let isFullAccess = true;
    let isProductionManager = false;
    try {
      if (this.workPermissionService?.getAllowedActivityTypesForEmployee) {
        const resolvedTypes = await this.workPermissionService.getAllowedActivityTypesForEmployee(
          numEmployeeId,
          (empRecord as any)?.customerId,
        );
        empRole = resolvedTypes.role;
        allowedTypes = resolvedTypes.allowedTypes;
        isFullAccess = resolvedTypes.isFullAccess;
        isProductionManager = resolvedTypes.isProductionManager;
      }
    } catch (permErr: any) {
      this.logger.warn(`getAllowedActivityTypesForEmployee warning: ${permErr?.message}`);
    }

    const tenantCustomerId = (empRecord as any)?.customerId;
    const rawDesignation = (empRecord as any)?.designation?.name;
    const nameInferred = `${(empRecord as any)?.firstName || ''} ${(empRecord as any)?.lastName || ''}`.trim();
    const designationName = rawDesignation || (workTypesForDesignation(nameInferred).length > 0 ? nameInferred : undefined);
    const designationLabel = String(designationName || '').toUpperCase();
    if (
      designationLabel.includes('PRODUCTION MANAGER') ||
      designationLabel.includes('PRODUCTION_MANAGER') ||
      designationLabel.includes('PROD MGR') ||
      designationLabel.includes('PRODUCTION LEAD') ||
      designationLabel.includes('PRODUCTION_LEAD')
    ) {
      isProductionManager = true;
    }
    const viewerCandidateIds = [numEmployeeId];
    const allTenantCustomers = options?.allTenantCustomers === true;
    // Mobile calendar always passes allTenantCustomers. That flag used to set
    // customer.id = the employee's company id, so only one customer came back.
    // A normal employee still uses team membership. A production manager keeps
    // the wider workspace view, scoped to this company.
    let productionTeamIds = !isProductionManager
      ? await this.activeProductionTeamIdsForEmployee(
          numEmployeeId,
          tenantCustomerId,
          viewerCandidateIds,
          options?.assignedOnly === true,
        )
      : [];
    if (
      !isProductionManager &&
      productionTeamIds.length === 0 &&
      typeof this.prisma.teamMember?.findMany !== 'function'
    ) {
      productionTeamIds = await this.productionTeamIdsFromEmployeeWorks(
        numEmployeeId,
        viewerCandidateIds,
      );
    }
    const membershipTeamIds = await this.employeeTeamIds(
      numEmployeeId,
      tenantCustomerId,
      viewerCandidateIds,
      options?.assignedOnly === true,
    );
    const authorizedTeamIds = [...new Set([...productionTeamIds, ...membershipTeamIds])];
    const teamCustomerIds = !isProductionManager
      ? await this.customerIdsAssignedToTeams(authorizedTeamIds)
      : [];

    const assignedCustomers = typeof this.prisma.customer?.findMany === 'function'
      ? await this.prisma.customer.findMany({
          where: {
            deletedAt: null,
            OR: [
              { assignedEmployeeId: numEmployeeId },
              { createdByEmployeeId: numEmployeeId },
              ...(empRecord?.employeeCode ? [{ assignedEmployee: empRecord.employeeCode }] : []),
              ...(nameInferred ? [{ assignedEmployee: nameInferred }] : []),
              {
                originLead: {
                  deletedAt: null,
                  OR: [
                    { employeeId: numEmployeeId },
                    { assignedToId: numEmployeeId },
                    ...(empRecord?.userId ? [{ assignedToId: Number(empRecord.userId) }] : []),
                  ],
                },
              },
            ],
          },
          select: {
            id: true,
            assignedEmployeeId: true,
            createdByEmployeeId: true,
            assignedEmployee: true,
            originLead: {
              select: {
                employeeId: true,
                assignedToId: true,
              },
            },
          },
        })
      : [];
    const directCustomerIds = (Array.isArray(assignedCustomers) ? assignedCustomers : [])
      .filter((c) => {
        if (Number(c.assignedEmployeeId) === numEmployeeId) return true;
        if (Number(c.createdByEmployeeId) === numEmployeeId) return true;
        if (empRecord?.employeeCode && c.assignedEmployee === empRecord.employeeCode) return true;
        if (nameInferred && c.assignedEmployee === nameInferred) return true;
        if (c.originLead && (
          Number(c.originLead.employeeId) === numEmployeeId ||
          Number(c.originLead.assignedToId) === numEmployeeId ||
          (empRecord?.userId && Number(c.originLead.assignedToId) === Number(empRecord.userId))
        )) return true;
        return false;
      })
      .map((c) => c.id);
    const allAuthorizedCustomerIds = [...new Set([...directCustomerIds, ...teamCustomerIds])];

    let where: any;
    const assignedOnly = options?.assignedOnly === true;

    const directAssignment = (): any[] => {
      const conds: any[] = [
        { assignedToId: numEmployeeId },
        { editorId: numEmployeeId },
        { tasks: { some: { assignedToId: numEmployeeId } } },
        { customer: { assignedEmployeeId: numEmployeeId } },
        { customer: { createdByEmployeeId: numEmployeeId } },
        {
          customer: {
            originLead: {
              deletedAt: null,
              OR: [
                { employeeId: numEmployeeId },
                { assignedToId: numEmployeeId },
                ...(empRecord?.userId ? [{ assignedToId: Number(empRecord.userId) }] : []),
              ],
            },
          },
        },
      ];
      if (directCustomerIds.length > 0) {
        conds.push({ customerId: { in: directCustomerIds } });
      }
      for (const cid of viewerCandidateIds) {
        if (cid !== numEmployeeId) {
          conds.push(
            { assignedToId: cid },
            { editorId: cid },
            { tasks: { some: { assignedToId: cid } } },
            { customer: { assignedEmployeeId: cid } },
            { customer: { createdByEmployeeId: cid } },
            {
              customer: {
                originLead: {
                  deletedAt: null,
                  OR: [
                    { employeeId: cid },
                    { assignedToId: cid },
                  ],
                },
              },
            },
          );
        }
      }
      return conds;
    };

    const teamCustomerWork = (teamIds: number[]) =>
      teamIds.length === 0
        ? []
        : [
            { teamId: { in: teamIds } },
            {
              customer: {
                deletedAt: null,
                assignedTeamId: { in: teamIds },
              },
            },
          ];

    const designationTypes = workTypesForDesignation(designationName);
    const enumWorkTypes = new Set<string>(Object.values(WorkType));
    const visibleTypes = new Set(
      designationTypes.filter((type) => enumWorkTypes.has(type)),
    );
    // Designation text can be "Production" while the role still has video_edit / reel_shoot permissions.
    if (visibleTypes.size === 0 && !isFullAccess && !isProductionManager) {
      for (const type of allowedTypes) {
        if (enumWorkTypes.has(type)) visibleTypes.add(type);
      }
      // video_edit permission is stored as REEL_EDIT. The Work rows use EDITING.
      if (allowedTypes.has('REEL_EDIT') || visibleTypes.has('EDITING') || visibleTypes.has('VIDEO_EDITING')) {
        for (const type of ['EDITING', 'VIDEO_EDITING', 'VIDEO']) {
          if (enumWorkTypes.has(type)) visibleTypes.add(type);
        }
      }
    }
    if (assignedOnly) {
      // Own assignments, plus customers allotted to this employee's teams.
      // Customer.assignedTeamId is the allotment. Company id is not.
      where = {
        OR: [
          ...directAssignment(),
          ...teamCustomerWork(authorizedTeamIds),
          ...(teamCustomerIds.length > 0 ? [{ customerId: { in: teamCustomerIds } }] : []),
        ],
        status: { not: WorkStatus.CANCELLED },
        ...(query.teamId ? { AND: [{ OR: [
          { teamId: Number(query.teamId) },
          { customer: { assignedTeamId: Number(query.teamId) } },
        ] }] } : {}),
      };
      if (query.customerId) {
        where.customerId = Number(query.customerId);
      }
    } else if (allTenantCustomers) {
      // Mobile Calendar and My Work always pass this flag. Visibility is the
      // employee's production teams, not customer.id = the company record.
      // That equality was returning only customer 91 when the employee
      // company id was 91, even though Team A has more customers.
      const orConditions: any[] = [
        ...directAssignment(),
        ...teamCustomerWork(authorizedTeamIds),
      ];
      if (authorizedTeamIds.length > 0) {
        orConditions.push(
          { teamId: { in: authorizedTeamIds } },
          { customer: { deletedAt: null, assignedTeamId: { in: authorizedTeamIds } } },
          { customer: { deletedAt: null, assignedTeam: { id: { in: authorizedTeamIds }, isActive: true } } },
          { team: { id: { in: authorizedTeamIds }, isActive: true } },
        );
      }
      orConditions.push(
        { team: { members: { some: { employeeId: numEmployeeId } } } },
        { team: { leaderId: numEmployeeId } },
        { customer: { deletedAt: null, assignedTeam: { members: { some: { employeeId: numEmployeeId } } } } },
        { customer: { deletedAt: null, assignedTeam: { leaderId: numEmployeeId } } },
      );
      if (teamCustomerIds.length > 0) {
        orConditions.push({ customerId: { in: teamCustomerIds } });
      }
      if (tenantCustomerId) {
        orConditions.push(
          { customerId: Number(tenantCustomerId) },
          { customer: { originLead: { customerId: Number(tenantCustomerId), deletedAt: null } } },
          { customer: { assignedTeam: { customerId: Number(tenantCustomerId), isActive: true } } },
        );
      }
      where = {
        OR: orConditions,
        status: { not: WorkStatus.CANCELLED },
      };

      if (query.customerId) {
        where.customerId = Number(query.customerId);
      }

      if (query.employeeId && isProductionManager) {
        const filterEmpId = Number(query.employeeId);
        where.OR = [
          { assignedToId: filterEmpId },
          { editorId: filterEmpId },
          { tasks: { some: { assignedToId: filterEmpId } } },
        ];
      }

      if (query.teamId && isProductionManager) {
        const filterTeamId = Number(query.teamId);
        const teamCond = [
          { teamId: filterTeamId },
          { customer: { assignedTeamId: filterTeamId } },
          { team: { members: { some: { teamId: filterTeamId } } } },
        ];
        if (where.OR) {
          where.AND = [{ OR: where.OR }, { OR: teamCond }];
          delete where.OR;
        } else {
          where.OR = teamCond;
        }
      }
    } else if (isProductionManager) {
      // Production Manager is a supervisory role!
      // Must be able to see and manage production work across ALL employees and teams under the permitted organization/workspace.
      // Do NOT give Production Manager the same restricted task visibility as a normal Employee.
      where = {
        status: { not: WorkStatus.CANCELLED },
        ...(tenantCustomerId ? { customer: { id: { gt: 0 } } } : {}),
      };

      // Filter by specific customer if requested
      if (query.customerId) {
        where.customerId = Number(query.customerId);
      }

      // Filter by specific employee if requested
      if (query.employeeId) {
        const filterEmpId = Number(query.employeeId);
        where.OR = [
          { assignedToId: filterEmpId },
          { editorId: filterEmpId },
          { tasks: { some: { assignedToId: filterEmpId } } },
        ];
      }

      // Filter by specific team if requested
      if (query.teamId) {
        const filterTeamId = Number(query.teamId);
        const teamCond = [
          { teamId: filterTeamId },
          { customer: { assignedTeamId: filterTeamId } },
          { team: { members: { some: { teamId: filterTeamId } } } },
        ];
        if (where.OR) {
          where.AND = [{ OR: where.OR }, { OR: teamCond }];
          delete where.OR;
        } else {
          where.OR = teamCond;
        }
      }
    } else {
      // NORMAL EMPLOYEE:
      // Employee sees only:
      // - Their own assigned work
      // - Their permitted team work if existing business rules allow it
      // - Their assigned customers
      // - Their own task/status actions
      const orConditions: any[] = [
        ...directAssignment(),
        ...teamCustomerWork(membershipTeamIds),
      ];

      if (productionTeamIds.length > 0) {
        orConditions.push(
          { teamId: { in: productionTeamIds } },
          { customer: { deletedAt: null, assignedTeamId: { in: productionTeamIds } } },
          { customer: { deletedAt: null, assignedTeam: { id: { in: productionTeamIds }, isActive: true } } },
          { team: { id: { in: productionTeamIds }, isActive: true } },
        );
      }
      orConditions.push(
        { team: { members: { some: { employeeId: numEmployeeId } } } },
        { team: { leaderId: numEmployeeId } },
        { customer: { deletedAt: null, assignedTeam: { members: { some: { employeeId: numEmployeeId } } } } },
        { customer: { deletedAt: null, assignedTeam: { leaderId: numEmployeeId } } },
      );
      if (teamCustomerIds.length > 0) {
        orConditions.push({ customerId: { in: teamCustomerIds } });
      }

      where = {
        OR: orConditions,
        status: { not: WorkStatus.CANCELLED },
      };

      if (query.customerId) {
        where.customerId = Number(query.customerId);
      }
    }


    if (query.status) {
      const qStatus = String(query.status).toUpperCase();
      if (qStatus === 'PENDING') {
        where.status = { in: [WorkStatus.SCHEDULED, WorkStatus.ASSIGNED] };
      } else if (qStatus === 'IN_PROGRESS') {
        where.status = { in: [WorkStatus.IN_PROGRESS, WorkStatus.PROCESSING] };
      } else if (qStatus === 'COMPLETED') {
        where.status = { in: [WorkStatus.COMPLETED, WorkStatus.APPROVED] };
      } else if (qStatus === 'BLOCKED') {
        where.status = 'BLOCKED' as any;
      } else if (Object.values(WorkStatus).includes(qStatus as any)) {
        where.status = qStatus as WorkStatus;
      }
    }

    if (query.workType) {
      where.workType = query.workType;
    }

    let targetDateStr: string | undefined;
    let targetYear: number | undefined;
    let targetMonth: number | undefined;
    let targetDay: number | undefined;
    let appliedMonth = query.month;
    let appliedYear = query.year;
    const rangeFromRaw = query.dateFrom || (query as any).startDate;
    const rangeToRaw = query.dateTo || (query as any).endDate;
    const rangeFromKey = rangeFromRaw ? String(rangeFromRaw).trim().slice(0, 10) : '';
    const rangeToKey = rangeToRaw ? String(rangeToRaw).trim().slice(0, 10) : '';
    // A week sends dateFrom and dateTo. Do not let a copied start date
    // collapse that range to the first day.
    const rangeIsMultiDay = Boolean(rangeFromKey && rangeToKey && rangeFromKey !== rangeToKey);
    const hasExplicitMonth = Boolean(query.month);
    if (hasExplicitMonth && !appliedYear) {
      appliedYear = new Date().getFullYear();
    }
    const hasExplicitRange = Boolean(
      query.date ||
      query.dateFrom ||
      query.dateTo ||
      (query as any).startDate ||
      (query as any).endDate ||
      hasExplicitMonth,
    );

    if (!rangeIsMultiDay && query.date) {
      targetDateStr = query.date.trim();
      const parts = targetDateStr.split('-').map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        const [y, m, day] = parts;
        targetYear = y;
        targetMonth = m;
        targetDay = day;
        // Expand Prisma query window by +/- 1 day to capture UTC/IST timezone offsets
        const startWindow = new Date(Date.UTC(y, m - 1, day - 1, 0, 0, 0, 0));
        const endWindow = new Date(Date.UTC(y, m - 1, day + 1, 23, 59, 59, 999));
        where.scheduledDate = { gte: startWindow, lte: endWindow };
      } else {
        const d = new Date(query.date);
        if (!isNaN(d.getTime())) {
          targetYear = d.getFullYear();
          targetMonth = d.getMonth() + 1;
          targetDay = d.getDate();
          const startWindow = new Date(d.getTime() - 24 * 60 * 60 * 1000);
          const endWindow = new Date(d.getTime() + 24 * 60 * 60 * 1000);
          where.scheduledDate = { gte: startWindow, lte: endWindow };
        }
      }
    } else if (!rangeIsMultiDay && appliedMonth && appliedYear) {
      targetYear = appliedYear;
      targetMonth = appliedMonth;
      // Buffer by +/- 1 day on month edges to avoid timezone truncation
      const startOfMonth = new Date(Date.UTC(appliedYear, appliedMonth - 1, 0, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(appliedYear, appliedMonth, 2, 23, 59, 59, 999));
      where.scheduledDate = { gte: startOfMonth, lte: endOfMonth };
    } else if (rangeFromKey || rangeToKey) {
      where.scheduledDate = {};
      if (rangeFromKey) {
        const [y, m, d] = rangeFromKey.split('-').map(Number);
        where.scheduledDate.gte = new Date(Date.UTC(y, m - 1, d - 1, 0, 0, 0, 0));
      }
      if (rangeToKey) {
        const [y, m, d] = rangeToKey.split('-').map(Number);
        where.scheduledDate.lte = new Date(Date.UTC(y, m - 1, d + 1, 23, 59, 59, 999));
      }
    }

    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      { customer: { deletedAt: null } },
    ];

    if (process.env.EMPLOYEE_CALENDAR_DEBUG === 'true' && typeof this.prisma.work?.count === 'function' && tenantCustomerId) {
      const tenantWork = {
        OR: [
          { customerId: Number(tenantCustomerId) },
          { customer: { assignedTeam: { customerId: Number(tenantCustomerId) } } },
          ...directAssignment(),
          ...teamCustomerWork(membershipTeamIds),
        ],
      };
      const activeWork = {
        AND: [tenantWork, { status: { not: WorkStatus.CANCELLED }, customer: { deletedAt: null } }],
      };
      const countSafe = async (label: string, countWhere: any) => {
        try {
          return await this.prisma.work.count({ where: countWhere });
        } catch (err: any) {
          this.logger.warn(`[EMPLOYEE_CALENDAR_STAGE] ${label} skipped: ${err?.message}`);
          return -1;
        }
      };
      const stageTotal = await countSafe('tenant', tenantWork);
      const stageActive = await countSafe('active', activeWork);
      const dateWindow = where.scheduledDate ? { scheduledDate: where.scheduledDate } : {};
      const stageDate = await countSafe('dateRange', { AND: [tenantWork, dateWindow] });
      const stageStatus = await countSafe('status', { AND: [tenantWork, dateWindow, { status: where.status }] });
      const stageDirect = await countSafe('direct', { AND: [activeWork, dateWindow, { OR: directAssignment() }] });
      const stageTeam = membershipTeamIds.length === 0
        ? 0
        : await countSafe('team', { AND: [activeWork, dateWindow, { teamId: { in: membershipTeamIds } }] });
      const stageCustomerTeam = membershipTeamIds.length === 0
        ? 0
        : await countSafe('customerTeam', {
            AND: [activeWork, dateWindow, { customer: { deletedAt: null, assignedTeamId: { in: membershipTeamIds } } }],
          });
      this.logger.log(
        `[EMPLOYEE_CALENDAR_STAGE] employeeId=${numEmployeeId} tenantId=${tenantCustomerId} ` +
        `tenantWorks=${stageTotal} totalSchedulesInDateRange=${stageDate} statusFilteredMatches=${stageStatus} afterActiveDeleted=${stageActive} ` +
        `directAssignments=${stageDirect} teamAssignments=${stageTeam} ` +
        `customerTeamWorks=${stageCustomerTeam} ` +
        `appliedMonth=${appliedMonth ?? 'none'} appliedYear=${appliedYear ?? 'none'}`,
      );
    }

    const items = await this.prisma.work.findMany({
      where,
      orderBy: { scheduledDate: 'asc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            companyName: true,
            address: true,
            city: true,
            state: true,
            assignedEmployeeId: true,
            assignedEmployeeRel: {
              select: { id: true, firstName: true, lastName: true },
            },
            assignedTeamId: true,
            assignedTeam: {
              select: {
                id: true,
                name: true,
                customerId: true,
                leaderId: true,
                members: { select: { employeeId: true } },
              },
            },
            createdByEmployeeId: true,
            originLead: {
              select: {
                id: true,
                customerId: true,
                employeeId: true,
                assignedToId: true,
              },
            },
            socialMediaHandlers: {
              take: 5,
              select: { platform: true, accountName: true, accountUrl: true, status: true },
            },
          },
        },
        team: {
          select: {
            id: true,
            name: true,
            description: true,
            leaderId: true,
            members: {
              select: {
                employeeId: true,
                employee: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: {
              select: {
                userRoles: {
                  select: { role: { select: { type: true, name: true } } },
                },
              },
            },
          },
        },
        editor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: {
              select: {
                userRoles: {
                  select: { role: { select: { type: true, name: true } } },
                },
              },
            },
          },
        },
        entitlement: { select: { serviceName: true } },
        subscription: {
          select: {
            id: true,
            plan: { select: { name: true } },
          },
        },
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            stepOrder: true,
            assignedToId: true,
            notes: true,
            createdAt: true,
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                department: { select: { name: true } },
                designation: { select: { name: true } },
                user: {
                  select: {
                    userRoles: {
                      select: { role: { select: { type: true, name: true } } },
                    },
                  },
                },
              },
            },
          },
          orderBy: { stepOrder: 'asc' },
        },
      },
    });

    // Timezone normalization helpers: check Direct String, UTC, Server Local, and IST (+05:30)
    const matchesTargetDate = (dateVal: any, tY: number, tM: number, tD: number): boolean => {
      const key = this.scheduleDateKey(dateVal);
      if (!key) return false;
      const [sy, sm, sd] = key.split('-').map(Number);
      return sy === tY && sm === tM && sd === tD;
    };

    const matchesTargetMonth = (dateVal: any, tY: number, tM: number): boolean => {
      const key = this.scheduleDateKey(dateVal);
      if (!key) return false;
      const [sy, sm] = key.split('-').map(Number);
      return sy === tY && sm === tM;
    };

    // Filter items according to queried date / month
    let filteredItems = items;
    if (targetYear && targetMonth && targetDay) {
      filteredItems = items.filter((w) => matchesTargetDate(w.scheduledDate, targetYear!, targetMonth!, targetDay!));
    } else if (targetYear && targetMonth) {
      filteredItems = items.filter((w) => matchesTargetMonth(w.scheduledDate, targetYear!, targetMonth!));
    } else if (rangeFromKey || rangeToKey) {
      filteredItems = items.filter((w) => {
        const key = this.scheduleDateKey(w.scheduledDate);
        if (!key) return false;
        if (rangeFromKey && key < rangeFromKey) return false;
        if (rangeToKey && key > rangeToKey) return false;
        return true;
      });
    }

    const dateMatchedCount = filteredItems.length;
    const viewerIds = new Set<number>(viewerCandidateIds);
    const matchesRole = (w: any) => {
      const normalized = normalizeActivityType(w);
      return (
        visibleTypes.has(String(w.workType || '').toUpperCase()) ||
        workMatchesDesignation(designationName, w.workType) ||
        workMatchesDesignation(designationName, normalized) ||
        (visibleTypes.size === 0 && allowedTypes.has(normalized))
      );
    };
    const hasRoleRules = visibleTypes.size > 0 || allowedTypes.size > 0;
    const isDirectWorkAssignee = (w: any) => {
      if (viewerIds.has(Number(w.assignedToId))) return true;
      if (w.workType !== WorkType.REELS_SHOOT && w.workType !== WorkType.SHOOT) {
        if (viewerIds.has(Number(w.editorId))) return true;
      }
      return (w.tasks || []).some((task: any) =>
        viewerIds.has(Number(task.assignedToId)) &&
        w.workType !== WorkType.REELS_SHOOT && w.workType !== WorkType.SHOOT,
      );
    };

    const isCustomerOrLeadOwner = (w: any) => {
      const custId = Number(w.customerId || w.customer?.id || 0);
      if (custId > 0 && directCustomerIds.includes(custId)) return true;
      const ownerIds = [
        w.customer?.assignedEmployeeId,
        w.customer?.createdByEmployeeId,
        w.customer?.originLead?.employeeId,
        w.customer?.originLead?.assignedToId,
      ]
        .filter((id) => id != null)
        .map(Number);
      const codeMatches = empRecord?.employeeCode && w.customer?.assignedEmployee === empRecord.employeeCode;
      const nameMatches = nameInferred && w.customer?.assignedEmployee === nameInferred;
      return ownerIds.some((id) => viewerIds.has(id)) || Boolean(codeMatches) || Boolean(nameMatches);
    };

    const isTelecallerOrBpo = ['TELECALLER', 'CALLER', 'SALES', 'BPO'].some((k) =>
      designationLabel.includes(k) || String((empRecord as any)?.department?.name || '').toUpperCase().includes(k),
    );

    if (assignedOnly || !isProductionManager) {
      filteredItems = filteredItems.filter((w) => {
        if (isDirectWorkAssignee(w)) return true;

        if (isCustomerOrLeadOwner(w)) return true;

        const teamId = Number(w.teamId || w.team?.id || 0);
        const customerTeamId = Number(w.customer?.assignedTeamId || w.customer?.assignedTeam?.id || 0);
        const memberOfTeam = [w.team, w.customer?.assignedTeam].some((team) =>
          (team?.members || []).some((member: any) => viewerIds.has(Number(member.employeeId))) ||
          viewerIds.has(Number(team?.leaderId)));
        const customerAssigned = viewerIds.has(Number(w.customer?.assignedEmployeeId));
        const authorized = authorizedTeamIds.includes(teamId) ||
          authorizedTeamIds.includes(customerTeamId) ||
          allAuthorizedCustomerIds.includes(Number(w.customerId)) || memberOfTeam || customerAssigned;

        if (isTelecallerOrBpo) {
          return authorized;
        }

        const editing = ['VIDEO_EDITING', 'EDITING', 'VIDEO'].includes(w.workType);
        const otherOwnerId = editing ? (w.editorId ?? w.assignedToId) : w.assignedToId;
        const otherOwner = editing ? (w.editor ?? (w.editorId ? null : w.assignedTo)) : w.assignedTo;

        // If explicitly assigned to another member:
        if (otherOwnerId && !viewerIds.has(Number(otherOwnerId))) {
          const isSalesOrBpo = otherOwner
            ? ['BPO', 'SALES', 'CALL'].some((part) => String(otherOwner.department?.name || '').toUpperCase().includes(part))
            : false;
          if (!isSalesOrBpo) {
            if (!authorized) return false;
            if (assignedOnly && hasRoleRules && !matchesRole(w)) return false;
            return true;
          }
        }

        // If authorized on the team and on a team customer/work:
        if (authorized && (authorizedTeamIds.includes(teamId) || authorizedTeamIds.includes(customerTeamId) || memberOfTeam || allAuthorizedCustomerIds.includes(Number(w.customerId)))) {
          if (!allTenantCustomers && !matchesRole(w)) return false;
          if (assignedOnly && hasRoleRules && !matchesRole(w)) return false;
          if (!otherOwnerId && allowedTypes.size > 0 && !allowedTypes.has(normalizeActivityType(w))) return false;
          if (!otherOwnerId && hasRoleRules && !matchesRole(w)) {
            const isMonthQuery = Boolean(!query.date && (query.month || (query as any).year));
            if (!allTenantCustomers || !isMonthQuery) return false;
          }
          return true;
        }

        if (assignedOnly && !authorized) return false;

        // Unassigned tenant pool work:
        const isTenantScope =
          Number(w.customerId) === tenantCustomerId ||
          Number(w.customer?.originLead?.customerId) === tenantCustomerId ||
          Number(w.customer?.assignedTeam?.customerId) === tenantCustomerId;
        if (!isTenantScope && !authorized) return false;

        if (hasRoleRules && !matchesRole(w)) return false;

        return true;
      });
    }

    const formatScheduleDate = (dateVal: any): string => this.scheduleDateKey(dateVal) || '';

    const uniqueItems = [...new Map(filteredItems.map((w) => [String(w.id), w])).values()];
    const mapped = uniqueItems.map((w) => {
      const purchaseRef = w.subscriptionId
        ? `PUR-${String(w.subscriptionId).padStart(3, '0')}`
        : (w.subscription?.id ? `PUR-${String(w.subscription.id).padStart(3, '0')}` : `PUR-${String(w.customerId).padStart(3, '0')}`);
      const startTime = w.scheduledTime || '10:00 AM';
      const endTime = assignedOnly ? null : '11:00 AM';
      const prodName = w.entitlement?.serviceName || w.title || w.workType;
      const planName = w.subscription?.plan?.name || 'Active Plan';

      const schedDateVal = w.scheduledDate ? formatScheduleDate(w.scheduledDate) : null;

      const originalScheduleMatch = (w.notes || '').match(/\[ORIGINAL_SCHEDULE:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\]/);
      const originalScheduledDate = originalScheduleMatch ? originalScheduleMatch[1] : null;
      const isCarriedForward = Boolean(
        originalScheduledDate && (schedDateVal ? originalScheduledDate !== schedDateVal : true),
      );
      let carryForwardNote: string | null = null;
      if (isCarriedForward && originalScheduledDate) {
        const parts = originalScheduledDate.split('-').map(Number);
        if (parts.length === 3 && !parts.some(isNaN)) {
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          carryForwardNote = `Originally scheduled: ${String(parts[2]).padStart(2, '0')} ${months[parts[1] - 1]} ${parts[0]}`;
        } else {
          carryForwardNote = `Originally scheduled: ${originalScheduledDate}`;
        }
      }

      const customerLocation = [w.customer?.address, w.customer?.city, w.customer?.state]
        .filter(Boolean)
        .join(', ') || null;

      const scheduleAssignee = this.productionTaskAssignee(w);
      const employeeFields = getWorkEmployeeFields(w);

      const isViewerEditor =
        viewerCandidateIds.some((cid) => cid === Number(w.editorId)) ||
        (w.tasks || []).some(
          (t: any) =>
            viewerCandidateIds.includes(Number(t.assignedToId)) &&
            /edit|color|grade/i.test(t.title || ''),
        );
      const isViewerShooter =
        viewerCandidateIds.some((cid) => cid === Number(w.assignedToId)) ||
        (w.tasks || []).some(
          (t: any) =>
            viewerCandidateIds.includes(Number(t.assignedToId)) &&
            /shoot|camera|photo/i.test(t.title || ''),
        );

      let itemActivityType = normalizeActivityType(w);
      if (isViewerEditor && !isViewerShooter && w.workType !== 'REELS_SHOOT' && w.workType !== 'SHOOT') {
        itemActivityType = 'REEL_EDIT';
      } else if (isViewerShooter) {
        if (w.workType === 'REEL' || w.workType === 'REELS_SHOOT' || w.workType === 'SHOOT') {
          itemActivityType = 'REEL_SHOOT';
        }
      }

      const assignedEmpList: string[] = [];
      if (isProductionManager) {
        if (employeeFields.assignedEmployee) assignedEmpList.push(employeeFields.assignedEmployee);
      } else {
        if (employeeFields.assignedEmployee) assignedEmpList.push(employeeFields.assignedEmployee);
        if (employeeFields.editorName && !assignedEmpList.includes(employeeFields.editorName)) {
          assignedEmpList.push(employeeFields.editorName);
        }
      }

      const smHandler = w.customer?.socialMediaHandlers?.[0];
      const platform = smHandler?.platform || 'Instagram';
      const smAccount = smHandler?.accountName
        ? `${platform} — @${smHandler.accountName}`
        : (w.customer?.name ? `@${w.customer.name.toLowerCase().replace(/\s+/g, '')}` : 'Instagram');

      return {
        id: String(w.id),
        activityId: String(w.id),
        customerId: String(w.customerId),
        companyName: w.customer?.companyName || w.customer?.name || 'Customer Workspace',
        businessName: w.customer?.companyName || w.customer?.name || 'Customer Workspace',
        customerName: w.customer?.name || 'Customer',
        customerBusiness: w.customer?.companyName || w.customer?.name || 'Customer Workspace',
        purchaseId: purchaseRef,
        productName: prodName,
        serviceName: prodName,
        planName: planName,
        title: w.title,
        scheduledDate: schedDateVal,
        scheduledAt: w.scheduledDate,
        scheduledTime: startTime,
        originalScheduledDate,
        isCarriedForward,
        carryForwardNote,
        date: schedDateVal || w.scheduledDate,
        scheduleDate: schedDateVal || w.scheduledDate,
        time: startTime,
        startTime: startTime,
        endTime: endTime,
        type: itemActivityType,
        activityType: itemActivityType,
        workType: w.workType,
        status: w.status,
        location: customerLocation,
        canReschedule: false,
        canRequestRework: false,
        reworkActionLabel: null,
        isLocked: false,
        lockMessage: null,
        assignedEmployees: assignedEmpList,
        ...employeeFields,
        teamId: w.teamId || w.customer?.assignedTeamId || null,
        team: scheduleAssignee.teamName,
        assignedTeam: scheduleAssignee.teamName,
        notes: w.notes || w.description || null,
        outputUrl: w.outputUrl,
        feedback: w.feedback,
        revisionCount: w.revisionCount,
        socialMediaAccount: smAccount,
        platform: platform,
        tasks: w.tasks || [],
        durationDays: w.tasks?.length ? w.tasks.length : (w.workType === 'REEL' || w.workType === 'REELS_SHOOT' || w.workType === 'SHOOT' ? 3 : 1),
      };
    });

    // Query assigned tasks from Task model
    let tasksList: any[] = [];
    if (typeof this.prisma.task?.findMany === 'function' && (!query.workType || query.workType === 'TASK')) {
      const taskWhere: any = {
        deletedAt: null,
      };

      if (query.status) {
        taskWhere.status = query.status;
      } else {
        taskWhere.status = { not: TaskStatus.CANCELLED };
      }

      if (query.customerId) {
        taskWhere.customerId = Number(query.customerId);
      } else if (!assignedOnly && tenantCustomerId && !isProductionManager) {
        const tenantId = Number(tenantCustomerId);
        const tenantScope: any[] = [{ customerId: tenantId }];
        if (authorizedTeamIds.length > 0) {
          tenantScope.push({
            customer: { deletedAt: null, assignedTeamId: { in: authorizedTeamIds } },
          });
        }
        tenantScope.push({
          customer: { deletedAt: null, assignedTeam: { customerId: tenantId, isActive: true } },
        });
        if (allAuthorizedCustomerIds.length > 0) {
          tenantScope.push({ customerId: { in: allAuthorizedCustomerIds } });
        }
        taskWhere.AND = [...(taskWhere.AND || []), { OR: tenantScope }];
      }

      taskWhere.AND = [
        ...(taskWhere.AND || []),
        { customer: { deletedAt: null } },
      ];

      // My Calendar includes direct assignments and customers allotted to active teams.
      if (!assignedOnly && query.employeeId && isProductionManager) {
        const filterEmpId = Number(query.employeeId);
        taskWhere.OR = [
          { employeeId: filterEmpId },
          { assignedToId: filterEmpId },
        ];
      } else if (assignedOnly || !isProductionManager) {
        // Task.employeeId references Employee. Task.assignedToId references User.
        // Do not compare those columns to the other id; employee 2 and user 2 can be different people.
        const taskOr: any[] = [{ employeeId: numEmployeeId }];
        if (empRecord?.userId) {
          taskOr.push({ assignedToId: empRecord.userId });
        }
        if (authorizedTeamIds.length > 0) {
          taskOr.push({
            customer: { assignedTeamId: { in: authorizedTeamIds } },
          });
        }
        if (allAuthorizedCustomerIds.length > 0) {
          taskOr.push({ customerId: { in: allAuthorizedCustomerIds } });
        }
        taskWhere.OR = taskOr;
      }

      // Date range buffering for Prisma query
      if (!rangeIsMultiDay && query.date) {
        const d = new Date(query.date);
        if (!isNaN(d.getTime())) {
          const startWindow = new Date(d.getTime() - 24 * 60 * 60 * 1000);
          const endWindow = new Date(d.getTime() + 24 * 60 * 60 * 1000);
          taskWhere.AND = [
            ...(taskWhere.AND || []),
            {
              OR: [
                { dueDate: { gte: startWindow, lte: endWindow } },
                { startDate: { gte: startWindow, lte: endWindow } },
                { dueAt: { gte: startWindow, lte: endWindow } },
              ],
            },
          ];
        }
      } else if (!rangeIsMultiDay && appliedMonth && appliedYear) {
        const startOfMonth = new Date(Date.UTC(appliedYear, appliedMonth - 1, 0, 0, 0, 0, 0));
        const endOfMonth = new Date(Date.UTC(appliedYear, appliedMonth, 2, 23, 59, 59, 999));
        taskWhere.AND = [
          ...(taskWhere.AND || []),
          {
            OR: [
              { dueDate: { gte: startOfMonth, lte: endOfMonth } },
              { startDate: { gte: startOfMonth, lte: endOfMonth } },
              { dueAt: { gte: startOfMonth, lte: endOfMonth } },
            ],
          },
        ];
      } else if (query.dateFrom || query.dateTo || (query as any).startDate || (query as any).endDate) {
        const from = query.dateFrom || (query as any).startDate;
        const to = query.dateTo || (query as any).endDate;
        const fromDate = from ? new Date(new Date(from).getTime() - 24 * 60 * 60 * 1000) : undefined;
        const toDate = to ? new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000) : undefined;
        const rangeCond: any = {};
        if (fromDate) rangeCond.gte = fromDate;
        if (toDate) rangeCond.lte = toDate;
        taskWhere.AND = [
          ...(taskWhere.AND || []),
          {
            OR: [
              { dueDate: rangeCond },
              { startDate: rangeCond },
              { dueAt: rangeCond },
            ],
          },
        ];
      }

      tasksList = await this.prisma.task.findMany({
        where: taskWhere,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              companyName: true,
              address: true,
              city: true,
              state: true,
            },
          },
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
              designation: { select: { name: true } },
            },
          },
          department: { select: { name: true } },
          designation: { select: { name: true } },
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });
    }

    let filteredTasks = tasksList;
    if (targetYear && targetMonth && targetDay) {
      filteredTasks = tasksList.filter((t) =>
        matchesTargetDate(t.dueDate, targetYear!, targetMonth!, targetDay!) ||
        matchesTargetDate(t.startDate, targetYear!, targetMonth!, targetDay!) ||
        matchesTargetDate(t.dueAt, targetYear!, targetMonth!, targetDay!)
      );
    } else if (targetYear && targetMonth) {
      filteredTasks = tasksList.filter((t) =>
        matchesTargetMonth(t.dueDate, targetYear!, targetMonth!) ||
        matchesTargetMonth(t.startDate, targetYear!, targetMonth!) ||
        matchesTargetMonth(t.dueAt, targetYear!, targetMonth!)
      );
    } else if (rangeFromKey || rangeToKey) {
      filteredTasks = tasksList.filter((t) => {
        const keys = [t.dueDate, t.startDate, t.dueAt]
          .map((value) => this.scheduleDateKey(value))
          .filter((key): key is string => Boolean(key));
        return keys.some((key) => {
          if (rangeFromKey && key < rangeFromKey) return false;
          if (rangeToKey && key > rangeToKey) return false;
          return true;
        });
      });
    }

    const formatTaskTime = (d: Date): string => {
      const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      let hours = ist.getUTCHours();
      const minutes = String(ist.getUTCMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
    };

    const mappedTasks = filteredTasks.map((t) => {
      const taskScheduledDate =
        this.scheduleDateKey(t.dueDate) ||
        this.scheduleDateKey(t.startDate) ||
        this.scheduleDateKey(t.dueAt) ||
        targetDateStr ||
        '';
      const taskTime = t.dueTime || t.startTime || (t.dueAt ? formatTaskTime(t.dueAt) : '10:00 AM');
      const assignedEmp = t.employee
        ? `${t.employee.firstName || ''} ${t.employee.lastName || ''}`.trim()
        : (t.assignedTo ? `${t.assignedTo.firstName || ''} ${t.assignedTo.lastName || ''}`.trim() : 'Not assigned');

      return {
        id: String(t.id),
        activityId: String(t.id),
        customerId: String(t.customerId),
        companyName: t.customer?.companyName || t.customer?.name || 'Customer Workspace',
        businessName: t.customer?.companyName || t.customer?.name || 'Customer Workspace',
        customerName: t.customer?.name || 'Customer',
        customerBusiness: t.customer?.companyName || t.customer?.name || 'Customer Workspace',
        purchaseId: t.taskNumber || `TSK-${t.id}`,
        productName: t.title,
        serviceName: t.category || 'OPERATIONS',
        planName: 'General Task',
        title: t.title,
        scheduledDate: taskScheduledDate,
        scheduledAt: t.dueAt || t.dueDate || t.startDate || new Date(),
        scheduledTime: taskTime,
        originalScheduledDate: taskScheduledDate,
        isCarriedForward: false,
        carryForwardNote: null,
        date: taskScheduledDate,
        scheduleDate: taskScheduledDate,
        time: taskTime,
        startTime: taskTime,
        endTime: taskTime,
        type: 'TASK',
        activityType: 'TASK',
        workType: 'TASK',
        status: t.status,
        location: t.customer?.address ? `${t.customer.address}, ${t.customer.city || ''}`.trim() : 'Head Office',
        canReschedule: true,
        canRequestRework: false,
        reworkActionLabel: null,
        isLocked: false,
        lockMessage: null,
        assignedEmployees: assignedEmp && assignedEmp !== 'Not assigned' ? [assignedEmp] : [],
        editorName: null,
        teamId: null,
        team: t.department?.name || 'Operations',
        assignedTeam: t.department?.name || 'Operations',
        notes: t.notes || t.description || null,
        outputUrl: null,
        feedback: null,
        revisionCount: 0,
        socialMediaAccount: null,
        platform: null,
        tasks: [],
        durationDays: 1,
      };
    });

    // Fetch visits assigned to this employee across multiple customers/leads
    let mappedVisits: any[] = [];
    try {
      const visitWhere: any = {
        employeeId: numEmployeeId,
      };
      if (where.scheduledDate) {
        visitWhere.date = where.scheduledDate;
      }
      if (query.customerId) {
        visitWhere.customerId = Number(query.customerId);
      }
      if (typeof this.prisma.visit?.findMany === 'function') {
        const visits = await this.prisma.visit.findMany({
          where: visitWhere,
          orderBy: { date: 'asc' },
        });

        mappedVisits = visits.map((v: any) => {
          const schedDateVal = v.date ? formatScheduleDate(v.date) : null;
          const custName = v.customerName || 'Customer';
          const custBiz = custName;
          const startTime = v.time || '10:00 AM';
          const loc = v.location || null;

          return {
            id: `visit_${v.id}`,
            activityId: `visit_${v.id}`,
            visitId: v.id,
            customerId: String(v.customerId || 0),
            companyName: custBiz,
            businessName: custBiz,
            customerName: custName,
            customerBusiness: custBiz,
            purchaseId: `VISIT-${String(v.id).padStart(3, '0')}`,
            productName: v.purpose || 'Client Visit',
            serviceName: 'Client Visit',
            planName: 'Field Visit',
            title: `Visit: ${custName}`,
            scheduledDate: schedDateVal,
            scheduledAt: v.date,
            scheduledTime: startTime,
            originalScheduledDate: null,
            isCarriedForward: false,
            carryForwardNote: null,
            date: schedDateVal || v.date,
            scheduleDate: schedDateVal || v.date,
            time: startTime,
            startTime: startTime,
            endTime: null,
            type: 'CUSTOMER_VISIT',
            activityType: 'CUSTOMER_VISIT',
            workType: 'CUSTOMER_VISIT',
            status: v.status || 'SCHEDULED',
            location: loc,
            latitude: v.latitude,
            longitude: v.longitude,
            phone: null,
            canReschedule: true,
            canRequestRework: false,
            reworkActionLabel: null,
            isLocked: false,
            lockMessage: null,
            assignedEmployees: [nameInferred].filter(Boolean),
            assignedEmployee: nameInferred || 'Assigned Staff',
            assignedToId: String(numEmployeeId),
            teamId: null,
            team: 'Field Visits',
            assignedTeam: 'Field Visits',
            notes: v.notes || v.purpose || 'Client Visit',
            outputUrl: null,
            feedback: null,
            revisionCount: 0,
            socialMediaAccount: null,
            platform: null,
            tasks: [],
            durationDays: 1,
            itemType: 'VISIT',
            leadId: v.leadId,
          };
        });
      }
    } catch (vErr: any) {
      this.logger.warn(`Failed to query visits for calendar: ${vErr?.message}`);
    }

    // Fetch scheduled lead follow-ups for this employee across multiple customers
    let mappedLeads: any[] = [];
    try {
      const userNumId = Number((empRecord as any)?.userId);
      const leadOrConditions: any[] = [{ employeeId: numEmployeeId }];
      if (userNumId && !isNaN(userNumId)) {
        leadOrConditions.push({ assignedToId: userNumId });
      }

      const leadWhere: any = {
        OR: leadOrConditions,
        deletedAt: null,
        nextFollowUpDate: where.scheduledDate ? where.scheduledDate : { not: null },
      };
      if (query.customerId) {
        leadWhere.customerId = Number(query.customerId);
      }

      if (typeof this.prisma.lead?.findMany === 'function') {
        const leads = await this.prisma.lead.findMany({
          where: leadWhere,
          orderBy: { nextFollowUpDate: 'asc' },
          select: {
            id: true,
            title: true,
            firstName: true,
            lastName: true,
            companyName: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            status: true,
            priority: true,
            customerId: true,
            nextFollowUpDate: true,
            nextFollowUpTime: true,
            workNotes: true,
          },
        });

        mappedLeads = leads.map((l: any) => {
          const schedDateVal = l.nextFollowUpDate ? formatScheduleDate(l.nextFollowUpDate) : null;
          const leadName = [l.firstName, l.lastName].filter(Boolean).join(' ') || l.companyName || l.title || `Lead #${l.id}`;
          const leadBiz = l.companyName || leadName;
          const startTime = l.nextFollowUpTime || '10:00 AM';
          const loc = [l.address, l.city, l.state].filter(Boolean).join(', ') || null;

          return {
            id: `lead_${l.id}`,
            activityId: `lead_${l.id}`,
            leadId: l.id,
            customerId: String(l.customerId || 0),
            companyName: leadBiz,
            businessName: leadBiz,
            customerName: leadName,
            customerBusiness: leadBiz,
            purchaseId: `LEAD-${String(l.id).padStart(3, '0')}`,
            productName: `Follow-up: ${l.status}`,
            serviceName: 'Lead Follow-up',
            planName: 'Lead',
            title: `Follow-up: ${leadName}`,
            scheduledDate: schedDateVal,
            scheduledAt: l.nextFollowUpDate,
            scheduledTime: startTime,
            originalScheduledDate: null,
            isCarriedForward: false,
            carryForwardNote: null,
            date: schedDateVal || l.nextFollowUpDate,
            scheduleDate: schedDateVal || l.nextFollowUpDate,
            time: startTime,
            startTime: startTime,
            endTime: null,
            type: 'FOLLOW_UP',
            activityType: 'FOLLOW_UP',
            workType: 'FOLLOW_UP',
            status: l.status || 'NEW',
            location: loc,
            phone: l.phone || null,
            canReschedule: true,
            canRequestRework: false,
            reworkActionLabel: null,
            isLocked: false,
            lockMessage: null,
            assignedEmployees: [nameInferred].filter(Boolean),
            assignedEmployee: nameInferred || 'Assigned Staff',
            assignedToId: String(numEmployeeId),
            teamId: null,
            team: 'Sales & CRM',
            assignedTeam: 'Sales & CRM',
            notes: l.workNotes || `Scheduled follow-up with ${leadName}`,
            outputUrl: null,
            feedback: null,
            revisionCount: 0,
            socialMediaAccount: null,
            platform: null,
            tasks: [],
            durationDays: 1,
            itemType: 'LEAD',
          };
        });
      }
    } catch (lErr: any) {
      this.logger.warn(`Failed to query leads for calendar: ${lErr?.message}`);
    }

    let filteredVisits = mappedVisits;
    if (targetYear && targetMonth && targetDay) {
      filteredVisits = mappedVisits.filter((v) => matchesTargetDate(v.date, targetYear!, targetMonth!, targetDay!));
    } else if (targetYear && targetMonth) {
      filteredVisits = mappedVisits.filter((v) => matchesTargetMonth(v.date, targetYear!, targetMonth!));
    } else if (rangeFromKey || rangeToKey) {
      filteredVisits = mappedVisits.filter((v) => {
        const key = this.scheduleDateKey(v.date);
        if (!key) return false;
        if (rangeFromKey && key < rangeFromKey) return false;
        if (rangeToKey && key > rangeToKey) return false;
        return true;
      });
    }

    let filteredLeads = mappedLeads;
    if (targetYear && targetMonth && targetDay) {
      filteredLeads = mappedLeads.filter((l) => matchesTargetDate(l.date, targetYear!, targetMonth!, targetDay!));
    } else if (targetYear && targetMonth) {
      filteredLeads = mappedLeads.filter((l) => matchesTargetMonth(l.date, targetYear!, targetMonth!));
    } else if (rangeFromKey || rangeToKey) {
      filteredLeads = mappedLeads.filter((l) => {
        const key = this.scheduleDateKey(l.date);
        if (!key) return false;
        if (rangeFromKey && key < rangeFromKey) return false;
        if (rangeToKey && key > rangeToKey) return false;
        return true;
      });
    }

    const allItems = [...mapped, ...mappedTasks, ...filteredVisits, ...filteredLeads];
    const result = isFullAccess || allowedTypes.size === 0
      ? allItems
      : allItems.filter((item) =>
          allowedTypes.has(item.activityType) ||
          item.activityType === 'TASK' ||
          item.activityType === 'CUSTOMER_VISIT' ||
          item.activityType === 'FOLLOW_UP' ||
          item.type === 'TASK' ||
          item.type === 'CUSTOMER_VISIT' ||
          item.type === 'FOLLOW_UP' ||
          item.itemType === 'TASK' ||
          item.itemType === 'VISIT' ||
          item.itemType === 'LEAD' ||
          allAuthorizedCustomerIds.includes(Number(item.customerId)) ||
          viewerCandidateIds.includes(Number(item.assignedToId)) ||
          viewerCandidateIds.includes(Number(item.editorId))
        );

    this.logger.log(`[EMPLOYEE_CALENDAR_ROLE_FILTER]
employeeId: ${employeeId}
role: ${empRole}
isFullAccess: ${isFullAccess}
allowedTypes: ${Array.from(allowedTypes).join(', ')}
beforeFilter: ${mapped.length}
afterFilter: ${result.length}`);

    const directWorkCount = items.filter((w) =>
      Number(w.assignedToId) === numEmployeeId ||
      Number(w.editorId) === numEmployeeId ||
      Number(w.customer?.assignedEmployeeId) === numEmployeeId ||
      (w.tasks || []).some((task) => Number(task.assignedToId) === numEmployeeId),
    ).length;
    const teamWorkCount = items.filter((w) =>
      membershipTeamIds.includes(Number(w.teamId || w.team?.id)),
    ).length;
    const customerWorkCount = items.filter((w) =>
      membershipTeamIds.includes(Number(w.customer?.assignedTeamId)) ||
      teamCustomerIds.includes(Number(w.customerId)),
    ).length;
    const firstZeroStage = filteredItems.length > 0
      ? 'none'
      : items.length > 0
        ? 'dateOrVisibilityFilter'
        : visibleTypes.size === 0
          ? 'noAssignmentNoDesignation'
          : 'noWorkInCompanyOrDateScope';

    const workTaskRows = items.reduce((count: number, work: any) => count + (work.tasks?.length || 0), 0);
    const workTaskAssigned = items.reduce(
      (count: number, work: any) => count + (work.tasks || []).filter((task: any) => Number(task.assignedToId) > 0).length,
      0,
    );

    this.logger.log(
      `[EMPLOYEE_CALENDAR_DEBUG] ` +
      `authUserId=${empRecord?.userId ?? 'none'} ` +
      `resolvedEmployeeId=${numEmployeeId} ` +
      `employeeCode=${empRecord?.employeeCode ?? 'none'} ` +
      `designation=${designationName || 'none'} ` +
      `visibleTypes=${Array.from(visibleTypes).join(',') || 'none'} ` +
      `tenantId=${tenantCustomerId ?? 'none'} ` +
      `membershipTeams=${membershipTeamIds.join(',') || 'none'} ` +
      `productionTeams=${productionTeamIds.join(',') || 'none'} ` +
      `teamCustomers=${teamCustomerIds.join(',') || 'none'} ` +
      `directWorkCount=${directWorkCount} ` +
      `teamWorkCount=${teamWorkCount} ` +
      `customerWorkCount=${customerWorkCount} ` +
      `rawWorkCount=${items.length} ` +
      `dateMatchedCount=${dateMatchedCount} visibilityExcludedCount=${dateMatchedCount - filteredItems.length} ` +
      `workTaskRows=${workTaskRows} ` +
      `workTaskAssigned=${workTaskAssigned} ` +
      `requestedDate=${targetDateStr || 'none'} ` +
      `dateFrom=${rangeFromKey || 'none'} dateTo=${rangeToKey || 'none'} ` +
      `month=${appliedMonth ?? query.month ?? 'none'} year=${appliedYear ?? query.year ?? 'none'} ` +
      `workCount=${filteredItems.length} ` +
      `taskCount=${filteredTasks.length} ` +
      `finalCount=${result.length} ` +
      `exclusion=${firstZeroStage}`,
    );

    const minutesOfDay = (value?: string | null) => {
      const match = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(value || ''));
      if (!match) return 0;
      let hours = Number(match[1]) % 12;
      if ((match[3] || '').toUpperCase() === 'PM') hours += 12;
      return hours * 60 + Number(match[2]);
    };
    const seen = new Set<string>();
    const uniqueResult = result.filter((item) => {
      const key = `${item.activityType || item.workType || 'WORK'}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.logger.log(`[EMPLOYEE_CALENDAR_DEBUG] resolvedEmployeeId=${numEmployeeId} finalReturnedRecordCount=${uniqueResult.length}`);

    const uniqueCustIds = [...new Set(uniqueResult.map((r) => r.customerId).filter(Boolean))];
    this.logger.log(`[EMPLOYEE_CALENDAR_AUDIT]
employeeId: ${numEmployeeId}
teamIds: ${JSON.stringify(authorizedTeamIds)}
total assigned works: ${filteredItems.length}
unique customerIds: ${JSON.stringify(uniqueCustIds)}
records returned by API: ${uniqueResult.length}`);

    uniqueResult.sort((a, b) => {
      const dateCompare = String(a.scheduledDate || '').localeCompare(String(b.scheduledDate || ''));
      if (dateCompare !== 0) return dateCompare;
      return minutesOfDay(a.scheduledTime || a.time) - minutesOfDay(b.scheduledTime || b.time);
    });

    for (const item of uniqueResult) {
      this.logger.log(`[EMPLOYEE_CALENDAR_ITEM]
activityId: ${item.id}
purchaseId: ${item.purchaseId}
customer: ${item.customerName}
type: ${item.activityType}
scheduledDate: ${item.scheduledDate}
time: ${item.time}
status: ${item.status}`);
    }

    return uniqueResult;
  }

  /**
   * Get production dashboard metrics for supervisory Production Manager.
   * Derives real metrics strictly from the shared Work/Calendar records.
   */
  async getProductionMetrics(
    employeeId: number,
    query: {
      customerId?: number;
      employeeId?: number;
      teamId?: number;
      date?: string;
      dateFrom?: string;
      dateTo?: string;
      month?: number;
      year?: number;
    } = {},
    options?: { allTenantCustomers?: boolean; assignedOnly?: boolean },
  ) {
    const works = await this.getEmployeeCalendar(
      employeeId,
      query,
      options ?? { allTenantCustomers: true },
    );

    const total = works.length;
    let pending = 0;
    let inProgress = 0;
    let completed = 0;
    let blocked = 0;
    let today = 0;
    let overdue = 0;

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    for (const w of works) {
      const s = String(w.status || '').toUpperCase();
      if (s === 'COMPLETED' || s === 'APPROVED') {
        completed++;
      } else if (s === 'IN_PROGRESS' || s === 'PROCESSING') {
        inProgress++;
      } else if (s === 'BLOCKED') {
        blocked++;
      } else {
        pending++;
      }

      const itemDate = w.scheduledDate || (typeof w.date === 'string' ? w.date.split('T')[0] : '');
      if (itemDate === todayStr) {
        today++;
      }

      if (itemDate && itemDate < todayStr && s !== 'COMPLETED' && s !== 'APPROVED' && s !== 'CANCELLED') {
        overdue++;
      }
    }

    return {
      total,
      pending,
      inProgress,
      completed,
      blocked,
      today,
      overdue,
    };
  }

  /**
   * Get filter options (customers, employees, teams, statuses) for Production Manager dashboard.
   */
  async getProductionFilterOptions(employeeId: number) {
    const works = await this.getEmployeeCalendar(employeeId, {}, { allTenantCustomers: true });
    const customerMap = new Map<number, string>();
    const employeeMap = new Map<number, string>();
    const teamMap = new Map<number, string>();

    for (const w of works) {
      if (w.customerId && w.customerName) {
        customerMap.set(Number(w.customerId), w.customerName);
      }
    }

    const numEmployeeId = Number(employeeId);
    const emp = await this.prisma.employee.findUnique({
      where: { id: numEmployeeId },
      select: { customerId: true, status: true },
    });

    if (emp?.customerId) {
      const nonBpoTeamMatch = {
        isActive: true,
        customerId: emp.customerId,
        NOT: { name: { contains: 'BPO', mode: Prisma.QueryMode.insensitive } },
        OR: [
          { leaderId: numEmployeeId },
          { members: { some: { employeeId: numEmployeeId } } },
        ],
      };
      const productionEmployees = await this.prisma.employee.findMany({
        where: {
          customerId: emp.customerId,
          NOT: { status: 'INACTIVE' },
          OR: [
            { teamMembers: { some: { team: { customerId: emp.customerId, isActive: true } } } },
            { ledTeams: { some: { customerId: emp.customerId, isActive: true } } },
          ],
        },
        select: { id: true, firstName: true, lastName: true },
      });
      for (const e of productionEmployees) {
        const name = `${e.firstName} ${e.lastName}`.trim();
        if (name && !employeeMap.has(e.id)) {
          employeeMap.set(e.id, name);
        }
      }

      const allTeams = await this.prisma.team.findMany({
        where: nonBpoTeamMatch,
        select: { id: true, name: true },
      });
      for (const t of allTeams) {
        if (t.name && !teamMap.has(t.id)) {
          teamMap.set(t.id, t.name);
        }
      }

      const relevantTeamIds = allTeams.map((t) => t.id);

      const allCustomers = await this.prisma.customer.findMany({
        where: {
          deletedAt: null,
          OR: [
            ...(relevantTeamIds.length > 0 ? [{ assignedTeamId: { in: relevantTeamIds } }] : []),
            { assignedEmployeeId: numEmployeeId },
          ],
        },
        select: { id: true, name: true, companyName: true },
      });
      for (const c of allCustomers) {
        const name = c.companyName || c.name;
        if (name && !customerMap.has(c.id)) {
          customerMap.set(c.id, name);
        }
      }
    }

    return {
      customers: Array.from(customerMap.entries()).map(([id, name]) => ({ id, name })),
      employees: Array.from(employeeMap.entries()).map(([id, name]) => ({ id, name })),
      teams: Array.from(teamMap.entries()).map(([id, name]) => ({ id, name })),
      statuses: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'],
    };
  }

  /**
   * Resolve employee record ID for a user by user ID or email.
   * Checks token payload, user.employee relation, userId, id, email, and phone.
   */
  async resolveEmployeeIdForUser(user: any): Promise<number | null> {
    if (!user) return null;
    const directEmployeeId = Number(user.employee?.id ?? user.employeeId);
    if (Number.isInteger(directEmployeeId) && directEmployeeId > 0) {
      return directEmployeeId;
    }

    const employeeCode = String(user.employeeCode || user.employee?.employeeCode || '').trim();
    if (employeeCode) {
      const codeCustomerId = Number(user.customerId || user.employee?.customerId);
      const byCode = await this.prisma.employee.findFirst({
        where: {
          ...(Number.isInteger(codeCustomerId) && codeCustomerId > 0 ? { customerId: codeCustomerId } : {}),
          employeeCode: { equals: employeeCode, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (byCode?.id) return byCode.id;
    }

    const rawUserId = Number(user.id ?? user.userId);
    if (Number.isInteger(rawUserId) && rawUserId > 0) {
      const byUser = await this.prisma.employee.findFirst({
        where: { userId: rawUserId },
        select: { id: true },
      });
      if (byUser?.id) return byUser.id;
    }

    const payloadEmployeeId = Number(user.employeeId);
    if (Number.isInteger(payloadEmployeeId) && payloadEmployeeId > 0) {
      const byPk = await this.prisma.employee.findFirst({
        where: { id: payloadEmployeeId },
        select: { id: true },
      });
      if (byPk?.id) return byPk.id;
    }

    const email = user.email ? String(user.email).trim().toLowerCase() : undefined;
    const phone = user.phone ? String(user.phone).trim() : undefined;
    const orConditions: any[] = [];
    if (email) {
      orConditions.push({ email: { equals: email, mode: 'insensitive' } });
    }
    if (phone) {
      orConditions.push({ phone });
    }
    if (orConditions.length === 0) return null;

    const employee = await this.prisma.employee.findFirst({
      where: { OR: orConditions },
      select: { id: true },
    });
    return employee?.id ?? null;
  }

  /**
   * Resolve canonical Employee ID from any identifier (Employee ID, User ID, or Employee Code).
   * Ensures User ID vs Employee ID mismatches are correctly resolved across calendars and assignment.
   */
  async resolveCanonicalEmployeeId(idOrCode: any, customerId?: number): Promise<number | null> {
    if (idOrCode == null) return null;
    if (typeof idOrCode === 'object') {
      return this.resolveEmployeeIdForUser(idOrCode);
    }
    const strVal = String(idOrCode).trim();
    if (!strVal) return null;

    const numVal = Number(strVal);
    if (Number.isInteger(numVal) && numVal > 0) {
      // 1. Direct Employee ID match
      const byEmpId = await this.prisma.employee.findUnique({
        where: { id: numVal },
        select: { id: true },
      });
      if (byEmpId?.id) return byEmpId.id;

      // 2. Check if numVal is actually a User ID linked to an Employee
      const byUserId = await this.prisma.employee.findFirst({
        where: { userId: numVal },
        select: { id: true },
      });
      if (byUserId?.id) return byUserId.id;
    }

    // 3. Match by employeeCode
    const codeWhere: any = {
      employeeCode: { equals: strVal, mode: 'insensitive' },
    };
    if (customerId && Number.isInteger(Number(customerId))) {
      codeWhere.customerId = Number(customerId);
    }
    const byCode = await this.prisma.employee.findFirst({
      where: codeWhere,
      select: { id: true },
    });
    if (byCode?.id) return byCode.id;

    return null;
  }

  /**
   * Get detailed plan service quotas and live usage breakdown for Customer / Admin
   */
  async getCustomerUsage(customerId: number | string) {
    const numCustomerId = Number(customerId);
    const plan = await this.getActivePlanDirect(numCustomerId);

    const entitlements = await this.prisma.planEntitlement.findMany({
      where: { customerId: numCustomerId },
      orderBy: { id: 'asc' },
    });

    const serviceQuotas = entitlements.map((e) => ({
      id: e.id,
      serviceName: e.serviceName,
      totalQty: e.totalQty,
      usedQty: e.usedQty,
      scheduledQty: e.scheduledQty,
      remainingQty: Math.max(0, e.totalQty - (e.usedQty + e.scheduledQty)),
      validUntil: e.validUntil || plan?.endDate,
    }));

    const totalLimit = entitlements.reduce((acc, e) => acc + (e.totalQty || 0), 0);
    const totalUsed = entitlements.reduce((acc, e) => acc + (e.usedQty || 0), 0);
    const totalRemaining = Math.max(0, totalLimit - totalUsed);

    return {
      hasActivePlan: plan?.isActive ?? false,
      planName: plan?.isActive ? plan.planName : 'No Active Plan',
      planCode: plan?.isActive ? plan.planCode : 'NONE',
      billingCycle: plan?.billingCycle,
      startDate: plan?.startDate,
      endDate: plan?.endDate,
      status: plan?.status,
      price: plan?.price,
      isExpired: plan?.isExpired ?? false,
      services: serviceQuotas,
      totalLimit,
      totalUsed,
      totalRemaining,
    };
  }

  /**
   * Automatically generate plan deliverable schedules dynamically according to the customer's PURCHASED PLAN.
   * Core Business Rules:
   * 1. 1 Reel = 1 Week workflow.
   * 2. Each Reel produces 3 activities:
   *    - Shoot: startDate + (reelIndex * 7 days)
   *    - Editing: shootDate + 2 days
   *    - Post: shootDate + 4 days
   * 3. Total activities = reelCount * 3 (e.g. 1 Reel = 3, 4 Reels = 12, 8 Reels = 24, 12 Reels = 36).
   * 4. Idempotency: Does NOT create duplicate schedules if already processed.
   * 5. Expiry guard: Bounded within subscription.endDate.
   */
  async generatePlanSchedules(customerId: number | string, subscriptionId?: number | string) {
    const numCustomerId = Number(customerId);
    if (!numCustomerId || isNaN(numCustomerId)) {
      throw new BadRequestException('Valid customer context required');
    }

    // 1. Resolve target subscription
    let targetSub: any = null;
    if (subscriptionId && !isNaN(Number(subscriptionId)) && Number(subscriptionId) > 0) {
      targetSub = await this.prisma.customerSubscription.findUnique({
        where: { id: Number(subscriptionId) },
        include: { plan: true, customer: true },
      });
    }

    if (!targetSub) {
      targetSub = await this.prisma.customerSubscription.findFirst({
        where: { customerId: numCustomerId, deletedAt: null, status: SubscriptionStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        include: { plan: true, customer: true },
      });
    }

    if (!targetSub || !targetSub.plan) {
      return {
        success: false,
        message: 'Cannot generate schedules. No active or valid subscription found.',
        createdCount: 0,
        schedules: [],
      };
    }

    const now = new Date();
    const isExpired = targetSub.status === SubscriptionStatus.EXPIRED || (targetSub.endDate ? now > new Date(targetSub.endDate) : false);
    if (isExpired && targetSub.status !== SubscriptionStatus.ACTIVE) {
      return {
        success: false,
        message: 'Cannot generate schedules. Subscription is expired.',
        createdCount: 0,
        schedules: [],
      };
    }

    // 2. Extract All Deliverable Quotas dynamically from purchased plan / custom features
    const effectiveFeatures = targetSub.customFeatures || targetSub.plan.features || [];
    let deliverableQuotas = extractDeliverableQuotas(effectiveFeatures);

    // Fallback: If no quotas found, check generic reel count
    if (deliverableQuotas.length === 0) {
      const reelCount = extractReelCount(effectiveFeatures);
      if (reelCount > 0) {
        deliverableQuotas.push({
          serviceName: 'Reels',
          totalQty: reelCount,
          workType: WorkType.REEL,
        });
      }
    }

    if (deliverableQuotas.length === 0) {
      return {
        success: true,
        message: 'No deliverable quotas configured in purchased plan.',
        createdCount: 0,
        schedules: [],
      };
    }

    // 1. Get the actual purchase/subscription start date from backend/database
    const rawPurchaseDate = targetSub.createdAt
      ? new Date(targetSub.createdAt)
      : (targetSub.startDate ? new Date(targetSub.startDate) : new Date());

    const pYear = rawPurchaseDate.getUTCFullYear();
    const pMonth = rawPurchaseDate.getUTCMonth();
    const pDay = rawPurchaseDate.getUTCDate();
    const purchaseDateStr = `${pYear}-${String(pMonth + 1).padStart(2, '0')}-${String(pDay).padStart(2, '0')}`;

    // 2. Calculate: scheduleStartDate = purchaseDate + 2 calendar days
    let scheduleStartDate: Date;
    if (targetSub.startDate) {
      const subStart = new Date(targetSub.startDate);
      const subStartStr = `${subStart.getUTCFullYear()}-${String(subStart.getUTCMonth() + 1).padStart(2, '0')}-${String(subStart.getUTCDate()).padStart(2, '0')}`;
      if (subStartStr !== purchaseDateStr) {
        // targetSub.startDate is already an advanced schedule start date
        scheduleStartDate = subStart;
      } else {
        // targetSub.startDate equals purchaseDate -> strictly advance by 2 calendar days
        scheduleStartDate = new Date(Date.UTC(pYear, pMonth, pDay + 2, 10, 0, 0, 0));
      }
    } else {
      scheduleStartDate = new Date(Date.UTC(pYear, pMonth, pDay + 2, 10, 0, 0, 0));
    }

    const sYear = scheduleStartDate.getUTCFullYear();
    const sMonth = scheduleStartDate.getUTCMonth();
    const sDay = scheduleStartDate.getUTCDate();
    const scheduleStartDateStr = `${sYear}-${String(sMonth + 1).padStart(2, '0')}-${String(sDay).padStart(2, '0')}`;

    let endDate = targetSub.endDate ? new Date(targetSub.endDate) : new Date(scheduleStartDate.getTime() + 30 * 86400000);
    if (endDate <= scheduleStartDate) {
      endDate = new Date(Date.UTC(sYear, sMonth + 1, sDay, 23, 59, 59, 999));
    }
    const endDateStr = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`;

    // 3. Generate the plan activities starting from scheduleStartDate
    const planActivities = generateAllPlanWorkflowActivities(scheduleStartDate, endDate, deliverableQuotas);

    this.logger.log(
      `[PLAN_SCHEDULE]\npurchaseDate: ${purchaseDateStr}\nscheduleStartDate: ${scheduleStartDateStr}\nactivePlanId: ${targetSub.planId || targetSub.id}\ngeneratedActivities: ${planActivities.length}`,
    );

    let totalCreated = 0;

    const allGeneratedWorks = await this.prisma.$transaction(async (tx) => {
      const isLeadConvertedCustomer = Boolean(targetSub.customer?.leadId);
      const productionTeamId = isLeadConvertedCustomer
        ? await this.resolveCustomerProductionTeam(numCustomerId, tx)
        : targetSub.customer?.assignedTeamId || null;
      // 1. Sync or provision PlanEntitlements for all quotas
      const entitlementMap = new Map<string, number>();

      for (const q of deliverableQuotas) {
        let entitlement = await tx.planEntitlement.findFirst({
          where: { customerId: numCustomerId, serviceName: q.serviceName },
        });

        if (entitlement) {
          entitlement = await tx.planEntitlement.update({
            where: { id: entitlement.id },
            data: {
              planId: targetSub.planId,
              totalQty: q.totalQty,
              validUntil: endDate,
            },
          });
        } else {
          entitlement = await tx.planEntitlement.create({
            data: {
              customerId: numCustomerId,
              planId: targetSub.planId,
              serviceName: q.serviceName,
              totalQty: q.totalQty,
              usedQty: 0,
              scheduledQty: 0,
              validUntil: endDate,
            },
          });
        }
        entitlementMap.set(q.serviceName.toLowerCase(), entitlement.id);
      }

      // 2. Query existing non-cancelled works for this subscription to ensure strict IDEMPOTENCY
      const existingWorks = await tx.work.findMany({
        where: {
          customerId: numCustomerId,
          subscriptionId: targetSub.id,
          status: { not: WorkStatus.CANCELLED },
        },
        orderBy: { id: 'asc' },
      });

      // If full set of activities already generated for this subscription, do NOT duplicate.
      // Still assign any unassigned production-team work to the eligible employee.
      if (existingWorks.length >= planActivities.length) {
        const existingTeamId = productionTeamId || targetSub.customer?.assignedTeamId || null;
        if (existingTeamId) {
          const existingTeam = await tx.team.findUnique({
            where: { id: existingTeamId },
            select: { name: true, description: true },
          });
          if (existingTeam && !this.isBpoOnlyTeam(existingTeam.name, existingTeam.description)) {
            await this.syncCustomerTeamWorkAssignments(numCustomerId, existingTeamId, tx, isLeadConvertedCustomer ? { onlyMissing: true } : undefined);
            return tx.work.findMany({
              where: {
                customerId: numCustomerId,
                subscriptionId: targetSub.id,
                status: { not: WorkStatus.CANCELLED },
              },
              orderBy: { id: 'asc' },
            });
          }
        }
        return existingWorks;
      }

      const existingTitles = new Set(existingWorks.map((w) => w.title.toLowerCase().trim()));
      const createdItems: any[] = [];

      const assignedTeamId = productionTeamId || targetSub.customer?.assignedTeamId || null;
      let productionMembers: any[] = [];
      let productionTeamCustomerId: number | null = null;
      if (assignedTeamId) {
        const team = await tx.team.findUnique({
          where: { id: assignedTeamId },
          include: {
            members: {
              include: {
                employee: {
                  select: {
                    id: true,
                    customerId: true,
                    status: true,
                    firstName: true,
                    lastName: true,
                    designation: { select: { name: true } },
                    department: { select: { name: true } },
                  },
                },
              },
            },
          },
        });
        const teamLabel = `${team?.name || ''} ${team?.description || ''}`.toUpperCase();
        if (team && !teamLabel.includes('BPO')) {
          productionMembers = team.members || [];
          productionTeamCustomerId = team.customerId;
        }
      }
      let roleAssignmentIndex = 0;
      const taskRoleIds = new Map<string, number[]>();
      const taskEmployee = async (type: WorkType, preferred?: number | null) => {
        if (!taskRoleIds.has(type)) taskRoleIds.set(type, productionMembers.length
          ? await this.eligibleProductionMemberIds({ workType: type }, productionMembers, productionTeamCustomerId)
          : []);
        const ids = taskRoleIds.get(type)!;
        return preferred && ids.includes(preferred) ? preferred : ids[0] ?? null;
      };


      for (const act of planActivities) {
        // Idempotency: Skip if activity with this title already exists for this subscription
        if (existingTitles.has(act.title.toLowerCase().trim())) {
          continue;
        }

        const entId = entitlementMap.get(act.serviceName.toLowerCase()) || null;
        const eligibleMemberIds = productionMembers.length
          ? await this.eligibleProductionMemberIds(
              act,
              productionMembers,
              productionTeamCustomerId,
            )
          : [];
        let matchedEmployeeId = eligibleMemberIds.length > 0
          ? eligibleMemberIds[roleAssignmentIndex % eligibleMemberIds.length]
          : null;
        // Customer origin must not disable the normal, permission-checked owner fallback.
        if (!matchedEmployeeId && targetSub.customer?.assignedEmployeeId) {
          const custEmp = tx.employee?.findUnique
            ? await tx.employee.findUnique({
                where: { id: Number(targetSub.customer.assignedEmployeeId) },
                select: { id: true, customerId: true, status: true, designation: { select: { name: true } }, department: { select: { name: true } } },
              })
            : null;
          const eligibleOwners = custEmp ? await this.eligibleProductionMemberIds(
            act, [{ employeeId: custEmp.id, employee: custEmp }], productionTeamCustomerId,
          ) : [];
          matchedEmployeeId = eligibleOwners[0] ?? null;
        }
        if (matchedEmployeeId) roleAssignmentIndex++;

        // For video / reel tasks, match video editor
        let matchedEditorId: number | null = null;
        const isReelOrVideoAct =
          act.workType === WorkType.REEL ||
          act.workType === WorkType.REELS_SHOOT ||
          act.workType === WorkType.SHOOT ||
          act.workType === WorkType.EDITING ||
          (isLeadConvertedCustomer && act.workType === WorkType.VIDEO_EDITING) ||
          (act.title && /reel|shoot|video|edit/i.test(act.title));
        if (isReelOrVideoAct && productionMembers.length > 0) {
          const editorIds = await this.eligibleProductionMemberIds(
            { workType: WorkType.EDITING, title: 'Video Editing' },
            productionMembers,
            productionTeamCustomerId,
          );
          if (editorIds.length > 0) {
            matchedEditorId = editorIds[0];
          }
        }
        if ((act.workType === WorkType.EDITING || (isLeadConvertedCustomer && act.workType === WorkType.VIDEO_EDITING)) && matchedEditorId) {
          matchedEmployeeId = matchedEditorId;
        }

        const createdWork = await tx.work.create({
          data: {
            customerId: numCustomerId,
            subscriptionId: targetSub.id,
            planId: targetSub.planId,
            entitlementId: entId,
            teamId: assignedTeamId,
            assignedToId: matchedEmployeeId,
            editorId: matchedEditorId,
            workType: act.workType,
            title: act.title,
            description: act.description,
            scheduledDate: act.scheduledDate,
            scheduledTime: act.scheduledTime,
            priority: 'MEDIUM',
            status: (matchedEmployeeId || matchedEditorId) ? WorkStatus.ASSIGNED : WorkStatus.SCHEDULED,
          },
        });

        if (isReelOrVideoAct) {
          await tx.workTask.createMany({
            data: [
              { workId: createdWork.id, title: `1. Reels Video Shoot`, stepOrder: 1, status: TaskStatus.PENDING, assignedToId: isLeadConvertedCustomer ? await taskEmployee(WorkType.SHOOT, matchedEmployeeId) : matchedEmployeeId },
              { workId: createdWork.id, title: `2. Video Editing & Color Grading`, stepOrder: 2, status: TaskStatus.PENDING, assignedToId: isLeadConvertedCustomer ? await taskEmployee(WorkType.EDITING, matchedEditorId) : matchedEditorId || matchedEmployeeId },
              { workId: createdWork.id, title: `3. Review & Client Approval`, stepOrder: 3, status: TaskStatus.PENDING, assignedToId: matchedEmployeeId },
              { workId: createdWork.id, title: `4. Social Media Feed Upload`, stepOrder: 4, status: TaskStatus.PENDING, assignedToId: isLeadConvertedCustomer ? await taskEmployee(WorkType.UPLOADING) : matchedEmployeeId },
            ],
          });
        } else {
          await tx.workTask.createMany({
            data: [
              { workId: createdWork.id, title: `1. Asset & Content Preparation`, stepOrder: 1, status: TaskStatus.PENDING, assignedToId: isLeadConvertedCustomer ? await taskEmployee(WorkType.CONTENT_WRITING) : matchedEmployeeId },
              { workId: createdWork.id, title: `2. Review & Client Approval`, stepOrder: 2, status: TaskStatus.PENDING, assignedToId: matchedEmployeeId },
              { workId: createdWork.id, title: `3. Final Deliverable Execution`, stepOrder: 3, status: TaskStatus.PENDING, assignedToId: matchedEmployeeId },
            ],
          });
        }

        createdItems.push(createdWork);
        totalCreated++;
      }

      if (isLeadConvertedCustomer && assignedTeamId) await this.syncCustomerTeamWorkAssignments(numCustomerId, assignedTeamId, tx, { onlyMissing: true });

      // Update entitlement scheduled counts
      for (const q of deliverableQuotas) {
        const entId = entitlementMap.get(q.serviceName.toLowerCase());
        if (entId) {
          const activeCount = await tx.work.count({
            where: {
              customerId: numCustomerId,
              subscriptionId: targetSub.id,
              entitlementId: entId,
              status: { not: WorkStatus.CANCELLED },
            },
          });

          await tx.planEntitlement.update({
            where: { id: entId },
            data: { scheduledQty: Math.min(activeCount, q.totalQty) },
          });
        }
      }

      return [...existingWorks, ...createdItems];
    });

    if (process.env.PLAN_ASSIGNMENT_DEBUG === 'true') {
      // Opt-in diagnostics contain identifiers/counts only, never customer contact data.
      const rows = await this.prisma.work.findMany({
        where: { customerId: numCustomerId, subscriptionId: targetSub.id, status: { not: WorkStatus.CANCELLED } },
        select: {
          id: true, teamId: true, assignedToId: true, editorId: true,
          assignedTo: { select: { departmentId: true } },
          editor: { select: { departmentId: true } },
          tasks: { select: { assignedToId: true, assignedTo: { select: { departmentId: true } } } },
        },
      });
      const ids = (values: Array<number | null | undefined>) => [...new Set(values.filter((id): id is number => id != null))];
      this.logger.debug(`${targetSub.customer?.leadId ? '[LEAD_CUSTOMER_PLAN_DEBUG]' : '[NORMAL_CUSTOMER_PLAN_DEBUG]'} ${JSON.stringify({
        customerId: numCustomerId,
        ...(targetSub.customer?.leadId ? { leadId: targetSub.customer.leadId, convertedCustomerId: numCustomerId } : {}),
        planId: targetSub.planId, subscriptionId: targetSub.id,
        // Individual calendar activities are Work rows in this backend.
        scheduleCount: rows.length, workCount: rows.length,
        taskCount: rows.reduce((count, row) => count + row.tasks.length, 0),
        departmentIds: ids(rows.flatMap(row => [row.assignedTo?.departmentId, row.editor?.departmentId, ...row.tasks.map(task => task.assignedTo?.departmentId)])),
        teamIds: ids(rows.map(row => row.teamId)),
        employeeIds: ids(rows.flatMap(row => [row.assignedToId, row.editorId, ...row.tasks.map(task => task.assignedToId)])),
      })}`);
    }

    return {
      success: true,
      message: `Successfully generated ${totalCreated} plan workflow activities for customer CUST-${numCustomerId}.`,
      createdCount: totalCreated,
      schedules: allGeneratedWorks,
    };
  }

  /**
   * Customer Reschedule existing schedule with workflow dependency recalculation.
   * Updates the SAME work record without creating duplicates or consuming extra quota.
   */
  async rescheduleWork(
    scopedCustomerId: number | string,
    id: number | string,
    dto: { scheduledDate: string; scheduledTime?: string; notes?: string },
  ) {
    const numCustomerId = Number(scopedCustomerId);
    const numId = Number(id);
    if (!numCustomerId || isNaN(numCustomerId)) {
      throw new ForbiddenException('Authenticated customer context required');
    }

    const existing = await this.findOne(numCustomerId, numId);
    if (existing.customerId !== numCustomerId) {
      throw new ForbiddenException('You do not have permission to reschedule this item.');
    }

    const statusStr = (existing.status || '').toString().toUpperCase();
    if (statusStr === 'COMPLETED' || statusStr === 'CANCELLED' || statusStr === 'DONE' || statusStr === 'APPROVED') {
      throw new BadRequestException(
        `Cannot reschedule a work item with status ${existing.status}. For completed activities, use the Rework option.`,
      );
    }

    const newDate = new Date(dto.scheduledDate);
    if (isNaN(newDate.getTime())) {
      throw new BadRequestException('Invalid scheduledDate format.');
    }

    // Verify Active Plan Validity
    const activePlan = await this.getActivePlanDirect(numCustomerId);
    if (activePlan) {
      if (activePlan.startDate && newDate < new Date(new Date(activePlan.startDate).setHours(0, 0, 0, 0))) {
        throw new BadRequestException('Cannot reschedule prior to your plan start date.');
      }
      if (activePlan.endDate && newDate > new Date(activePlan.endDate)) {
        throw new BadRequestException('Cannot reschedule past your plan expiration date.');
      }
    }

    const oldDateStr = existing.scheduledDate ? new Date(existing.scheduledDate).toISOString().split('T')[0] : 'N/A';
    const newDateStr = newDate.toISOString().split('T')[0];

    this.logger.log(
      `[RESCHEDULE_REQUEST] customerId: ${numCustomerId} activityId: ${numId} title: "${existing.title}" oldDate: ${oldDateStr} newDate: ${newDateStr}`,
    );

    // Validate Sunday / working day rule
    if (newDate.getDay() === 0) {
      const customerPolicy = await this.prisma.attendancePolicy.findFirst({
        where: { customerId: numCustomerId, isActive: true },
      });
      if (customerPolicy && customerPolicy.workingDaysPerWeek <= 5) {
        throw new BadRequestException('Rescheduling is not allowed on Sundays according to working calendar policy.');
      }
    }

    const titleLower = (existing.title || '').toLowerCase();
    const subId = existing.subscriptionId;

    // Execute reschedule & dependent recalculations in an atomic transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Update the target activity
      const updated = await tx.work.update({
        where: { id: numId },
        data: {
          scheduledDate: newDate,
          scheduledTime: dto.scheduledTime || existing.scheduledTime || '10:00 AM',
          notes: dto.notes ? `${existing.notes || ''}\n[Rescheduled]: ${dto.notes}`.trim() : existing.notes,
        },
        include: {
          customer: true,
          assignedTo: true,
          editor: true,
          entitlement: true,
          tasks: true,
        },
      });

      // 2. Cascading Workflow Dependency Recalculations
      if (subId) {
        const reelMatch = titleLower.match(/reel\s*#?(\d+)/i);
        const storyMatch = titleLower.match(/story\s*#?(\d+)/i);
        const postMatch = titleLower.match(/creative\s*post\s*#?(\d+)/i) || titleLower.match(/post\s*#?(\d+)/i);

        if (reelMatch) {
          const rNum = reelMatch[1];
          // If Shoot was moved:
          if (titleLower.includes('shoot')) {
            const editWork = await tx.work.findFirst({
              where: {
                subscriptionId: subId,
                title: { contains: `Reel #${rNum}: Edit`, mode: 'insensitive' },
                status: { not: WorkStatus.CANCELLED },
              },
            });
            if (editWork) {
              const minEditDate = new Date(newDate.getTime() + 2 * 86400000);
              if (new Date(editWork.scheduledDate) < minEditDate) {
                await tx.work.update({
                  where: { id: editWork.id },
                  data: { scheduledDate: minEditDate },
                });
                this.logger.log(
                  `[DEPENDENCY_UPDATE] parentActivity: "${existing.title}" childActivity: "${editWork.title}" oldDate: ${editWork.scheduledDate} newDate: ${minEditDate.toISOString()}`,
                );

                // Check and shift Post as well
                const postWork = await tx.work.findFirst({
                  where: {
                    subscriptionId: subId,
                    title: { contains: `Reel #${rNum}: Post`, mode: 'insensitive' },
                    status: { not: WorkStatus.CANCELLED },
                  },
                });
                if (postWork) {
                  const minPostDate = new Date(minEditDate.getTime() + 2 * 86400000);
                  if (new Date(postWork.scheduledDate) < minPostDate) {
                    await tx.work.update({
                      where: { id: postWork.id },
                      data: { scheduledDate: minPostDate },
                    });
                    this.logger.log(
                      `[DEPENDENCY_UPDATE] parentActivity: "${editWork.title}" childActivity: "${postWork.title}" oldDate: ${postWork.scheduledDate} newDate: ${minPostDate.toISOString()}`,
                    );
                  }
                }
              }
            }
          } else if (titleLower.includes('edit')) {
            // If Edit was moved, ensure Shoot is before it, and shift Post if necessary
            const shootWork = await tx.work.findFirst({
              where: {
                subscriptionId: subId,
                title: { contains: `Reel #${rNum}: Shoot`, mode: 'insensitive' },
                status: { not: WorkStatus.CANCELLED },
              },
            });
            if (shootWork && newDate < new Date(new Date(shootWork.scheduledDate).getTime() + 2 * 86400000)) {
              throw new BadRequestException(
                `Reel Edit must be scheduled at least 2 days after Reel Shoot (${new Date(shootWork.scheduledDate).toISOString().split('T')[0]}).`,
              );
            }

            const postWork = await tx.work.findFirst({
              where: {
                subscriptionId: subId,
                title: { contains: `Reel #${rNum}: Post`, mode: 'insensitive' },
                status: { not: WorkStatus.CANCELLED },
              },
            });
            if (postWork) {
              const minPostDate = new Date(newDate.getTime() + 2 * 86400000);
              if (new Date(postWork.scheduledDate) < minPostDate) {
                await tx.work.update({
                  where: { id: postWork.id },
                  data: { scheduledDate: minPostDate },
                });
                this.logger.log(
                  `[DEPENDENCY_UPDATE] parentActivity: "${existing.title}" childActivity: "${postWork.title}" oldDate: ${postWork.scheduledDate} newDate: ${minPostDate.toISOString()}`,
                );
              }
            }
          }
        } else if (storyMatch && titleLower.includes('design')) {
          const sNum = storyMatch[1];
          const postWork = await tx.work.findFirst({
            where: {
              subscriptionId: subId,
              title: { contains: `Story #${sNum}: Post`, mode: 'insensitive' },
              status: { not: WorkStatus.CANCELLED },
            },
          });
          if (postWork) {
            const minPostDate = new Date(newDate.getTime() + 1 * 86400000);
            if (new Date(postWork.scheduledDate) < minPostDate) {
              await tx.work.update({
                where: { id: postWork.id },
                data: { scheduledDate: minPostDate },
              });
              this.logger.log(
                `[DEPENDENCY_UPDATE] parentActivity: "${existing.title}" childActivity: "${postWork.title}" oldDate: ${postWork.scheduledDate} newDate: ${minPostDate.toISOString()}`,
              );
            }
          }
        } else if (postMatch && titleLower.includes('design')) {
          const pNum = postMatch[1];
          const pubWork = await tx.work.findFirst({
            where: {
              subscriptionId: subId,
              title: { contains: `Post #${pNum}: Publish`, mode: 'insensitive' },
              status: { not: WorkStatus.CANCELLED },
            },
          });
          if (pubWork) {
            const minPubDate = new Date(newDate.getTime() + 2 * 86400000);
            if (new Date(pubWork.scheduledDate) < minPubDate) {
              await tx.work.update({
                where: { id: pubWork.id },
                data: { scheduledDate: minPubDate },
              });
              this.logger.log(
                `[DEPENDENCY_UPDATE] parentActivity: "${existing.title}" childActivity: "${pubWork.title}" oldDate: ${pubWork.scheduledDate} newDate: ${minPubDate.toISOString()}`,
              );
            }
          }
        }
      }

      return updated;
    });

    // Notify assigned staff if present
    const staffUserIds = [result.assignedTo?.userId, result.editor?.userId].filter(Boolean) as number[];
    for (const uid of staffUserIds) {
      await this.prisma.notification.create({
        data: {
          customerId: result.customerId,
          userId: uid,
          title: 'Schedule Updated by Customer',
          message: `Customer rescheduled "${result.title}" to ${newDate.toLocaleDateString()} at ${result.scheduledTime}.`,
          type: 'SCHEDULE_RESCHEDULED',
          data: { workId: result.id, newDate: result.scheduledDate },
        },
      });
    }

    // 12. TASK RESCHEDULE -> PARTICULAR EMPLOYEE NOTIFICATION (via customer rescheduleWork)
    if (this.notificationService && result.assignedToId) {
      const customerName = result.customer?.companyName || result.customer?.name || null;
      this.notificationService
        .sendTaskRescheduledNotification({
          customerId: result.customerId,
          employeeId: result.assignedToId,
          workId: result.id,
          taskName: result.title || 'Task',
          newDate: result.scheduledDate,
          newTime: result.scheduledTime,
          customerName,
        })
        .catch((err) => {
          this.logger.warn(`Failed to dispatch TASK_RESCHEDULED push: ${err?.message}`);
        });
    }

    return {
      success: true,
      message: 'Schedule updated successfully.',
      work: result,
    };
  }

  /**
   * Customer Request Rework for completed activity.
   * Preserves historical completed record and provisions a new rework deliverable.
   */
  async requestRework(
    scopedCustomerId: number | string,
    id: number | string,
    dto: { reason?: string },
  ) {
    const numCustomerId = Number(scopedCustomerId);
    const numId = Number(id);
    if (!numCustomerId || isNaN(numCustomerId)) {
      throw new ForbiddenException('Authenticated customer context required');
    }

    const existing = await this.findOne(numCustomerId, numId);
    if (existing.customerId !== numCustomerId) {
      throw new ForbiddenException('You do not have permission to request rework for this item.');
    }

    const statusStr = (existing.status || '').toString().toUpperCase();
    if (statusStr !== 'COMPLETED' && statusStr !== 'APPROVED' && statusStr !== 'DONE') {
      throw new BadRequestException(
        `Cannot request rework for an item with status ${existing.status}. Rework is only available for completed activities.`,
      );
    }

    const reason = (dto.reason || '').trim();
    const revisionNumber = (existing.revisionCount || 0) + 1;

    this.logger.log(
      `[REWORK_REQUEST] customerId: ${numCustomerId} activityId: ${numId} title: "${existing.title}" type: ${existing.workType} revision: ${revisionNumber} reason: "${reason}"`,
    );

    const reworkItem = await this.prisma.$transaction(async (tx) => {
      // 1. Update original item with feedback/notes
      await tx.work.update({
        where: { id: numId },
        data: {
          feedback: reason || 'Rework requested by client',
          revisionCount: revisionNumber,
        },
      });

      // 2. Create new linked rework activity
      const newWork = await tx.work.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: existing.subscriptionId,
          planId: existing.planId,
          entitlementId: existing.entitlementId,
          assignedToId: existing.assignedToId,
          editorId: existing.editorId,
          teamId: existing.teamId,
          workType: existing.workType,
          title: `${existing.title} (Rework #${revisionNumber})`,
          description: reason ? `Rework requested: ${reason}` : `Rework for ${existing.title}`,
          scheduledDate: new Date(),
          scheduledTime: existing.scheduledTime || '10:00 AM',
          priority: 'HIGH',
          status: WorkStatus.SCHEDULED,
          notes: `Rework for completed Work #${existing.id}. Reason: ${reason || 'N/A'}`,
          revisionCount: revisionNumber,
        },
        include: {
          customer: true,
          assignedTo: true,
          editor: true,
          entitlement: true,
        },
      });

      // 3. Attach workflow tasks to the rework activity
      await tx.workTask.createMany({
        data: [
          { workId: newWork.id, title: `1. Review Client Feedback & Scope`, stepOrder: 1, status: TaskStatus.PENDING },
          { workId: newWork.id, title: `2. Execute Rework / Re-edit / Redesign`, stepOrder: 2, status: TaskStatus.PENDING },
          { workId: newWork.id, title: `3. Client Final Review & Approval`, stepOrder: 3, status: TaskStatus.PENDING },
        ],
      });

      return newWork;
    });

    // Notify assigned staff
    const staffUserIds = [reworkItem.assignedToId, reworkItem.editorId].filter(Boolean) as number[];
    for (const uid of staffUserIds) {
      await this.prisma.notification.create({
        data: {
          customerId: numCustomerId,
          userId: uid,
          title: 'Rework Requested by Customer',
          message: `Customer requested rework for "${existing.title}": ${reason || 'See details in task.'}`,
          type: 'REWORK_REQUESTED',
          data: { workId: reworkItem.id, originalWorkId: existing.id, reason },
        },
      });
    }

    this.emitRealtimeScheduleEvent(numCustomerId, 'PLAN_SCHEDULE_CREATED', {
      scheduleId: reworkItem.id,
      planId: existing.subscriptionId,
      date: reworkItem.scheduledDate ? new Date(reworkItem.scheduledDate).toISOString().split('T')[0] : undefined,
    });

    return {
      success: true,
      message: 'Rework request submitted successfully.',
      rework: reworkItem,
    };
  }

  /**
   * Auto-create activity schedules when customer buys a plan
   */
  async purchaseSubscription(
    customerId: number | string,
    planId: number | string,
  ) {
    const numCustomerId = Number(customerId);
    const numPlanId = Number(planId);
    if (!numCustomerId || isNaN(numCustomerId)) {
      throw new BadRequestException('Valid customer context required');
    }
    if (!numPlanId || isNaN(numPlanId)) {
      throw new BadRequestException('Valid planId required');
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: numPlanId },
    });
    if (!plan) {
      throw new NotFoundException(`Plan with ID ${numPlanId} not found`);
    }

    const { startDate, endDate } = calculateSubscriptionDates(new Date(), 1);

    const subscription = await this.prisma.customerSubscription.create({
      data: {
        customerId: numCustomerId,
        planId: numPlanId,
        startDate,
        endDate,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: SubscriptionBillingCycle.MONTHLY,
      },
      include: { plan: true },
    });

    const scheduleGenResult = await this.generatePlanSchedules(numCustomerId, subscription.id);

    this.emitRealtimeScheduleEvent(numCustomerId, 'ACTIVE_PLAN_UPDATED', {
      planId: subscription.planId,
      scheduleId: subscription.id,
    });

    return {
      success: true,
      subscriptionId: subscription.id,
      schedulesCreated: scheduleGenResult.createdCount,
      message: `Subscription created with ${scheduleGenResult.createdCount} activities scheduled`,
      schedules: scheduleGenResult.schedules,
    };
  }

  /**
   * Notify the work's customer after a non-completed → COMPLETED transition.
   * Runs only after the status update is committed. Delivery failure is logged
   * and does not change the completed work.
   */
  private async notifyCustomerWorkCompleted(work: {
    id: number;
    customerId: number;
    title?: string | null;
    subscriptionId?: number | null;
    planId?: number | null;
    customer?: {
      name?: string | null;
      companyName?: string | null;
      deletedAt?: Date | null;
      isActive?: boolean | null;
    } | null;
    assignedTo?: { firstName?: string | null; lastName?: string | null } | null;
  }) {
    if (!this.notificationService) return;

    try {
      const numCustomerId = Number(work.customerId);
      if (!numCustomerId || isNaN(numCustomerId)) {
        this.logger.warn(
          `[WORK_COMPLETED] Work #${work.id} has invalid customerId (${work.customerId}). Skipping notification.`,
        );
        return;
      }

      const customer = work.customer || (await this.prisma.customer.findFirst({
        where: { id: numCustomerId },
        select: { name: true, companyName: true, deletedAt: true, isActive: true },
      }));
      if (!customer) {
        this.logger.warn(
          `[WORK_COMPLETED] Work #${work.id} has no customer relation. Skipping customer notification.`,
        );
        return;
      }
      if (customer.deletedAt || customer.isActive === false) {
        this.logger.warn(
          `[WORK_COMPLETED] Customer #${numCustomerId} is deleted or inactive. Skipping notification for work #${work.id}.`,
        );
        return;
      }

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recent = await this.prisma.notification.findMany({
        where: {
          customerId: numCustomerId,
          type: 'WORK_COMPLETED',
          createdAt: { gte: tenMinutesAgo },
        },
        select: { data: true },
        take: 20,
        orderBy: { id: 'desc' },
      });
      const alreadyNotified = recent.some((row: any) => {
        const data = row?.data;
        const workId = data && typeof data === 'object' ? data.workId : undefined;
        return String(workId ?? '') === String(work.id);
      });
      if (alreadyNotified) {
        this.logger.log(
          `[WORK_COMPLETED] Customer #${numCustomerId} already notified for work #${work.id} within last 10m. Skipping duplicate.`,
        );
        return;
      }

      const taskName = (work.title || '').trim() || 'Task';
      const customerLabel = (customer.companyName || customer.name || '').trim();
      const employeeName = `${work.assignedTo?.firstName || ''} ${work.assignedTo?.lastName || ''}`.trim();
      const body = employeeName
        ? `Your task '${taskName}'${customerLabel ? ` for ${customerLabel}` : ''} has been completed by ${employeeName}.`
        : `${taskName} has been completed.`;

      await this.notificationService.sendPushNotification({
        customerId: numCustomerId,
        title: 'Task Completed',
        body,
        type: 'WORK_COMPLETED',
        data: {
          type: 'WORK_COMPLETED',
          workId: String(work.id),
          orderId: String(work.subscriptionId || ''),
          purchaseId: String(work.planId || ''),
          status: 'COMPLETED',
          route: '/customer/work-requests',
        },
      });
      this.logger.log(
        `Dispatched WORK_COMPLETED notification to customer #${numCustomerId} for work #${work.id}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to send WORK_COMPLETED notification to customer #${work.customerId} for work #${work.id} (non-fatal): ${err?.message}`,
      );
    }
  }

  /**
   * Mark activity schedule as completed
   */
  async completeActivity(
    activityScheduleId: number | string,
    customerId?: number | string,
  ) {
    const numWorkId = Number(activityScheduleId);
    if (!numWorkId || isNaN(numWorkId)) {
      throw new BadRequestException('Valid activityScheduleId required');
    }

    const whereClause: any = { id: numWorkId };
    if (customerId && !isNaN(Number(customerId))) {
      whereClause.customerId = Number(customerId);
    }

    const existing = await this.prisma.work.findFirst({
      where: whereClause,
    });
    if (!existing) {
      throw new NotFoundException(`Activity with ID ${numWorkId} not found or unauthorized`);
    }

    const wasAlreadyCompleted = existing.status === WorkStatus.COMPLETED;

    const updated = await this.prisma.work.update({
      where: { id: numWorkId },
      data: {
        status: WorkStatus.COMPLETED,
        completedAt: new Date(),
      },
      include: {
        customer: true,
        assignedTo: true,
      },
    });

    this.emitRealtimeScheduleEvent(existing.customerId, 'SCHEDULE_STATUS_CHANGED', {
      scheduleId: updated.id,
      status: 'completed',
    });

    if (!wasAlreadyCompleted) {
      await this.notifyCustomerWorkCompleted(updated);
    }

    return {
      success: true,
      activity: {
        id: updated.id,
        status: 'completed',
        completedAt: updated.completedAt,
      },
    };
  }

  /**
   * Skip an activity schedule
   */
  async skipActivity(activityScheduleId: number | string) {
    const numWorkId = Number(activityScheduleId);
    if (!numWorkId || isNaN(numWorkId)) {
      throw new BadRequestException('Valid activityScheduleId required');
    }

    const updated = await this.prisma.work.update({
      where: { id: numWorkId },
      data: {
        status: WorkStatus.CANCELLED,
      },
    });

    this.emitRealtimeScheduleEvent(updated.customerId, 'SCHEDULE_STATUS_CHANGED', {
      scheduleId: updated.id,
      status: 'cancelled',
    });

    return {
      success: true,
      activity: updated,
    };
  }

  /**
   * Get month calendar view grouped by date
   */
  async getMonthCalendar(
    customerId: number | string | undefined,
    year: number,
    month: number,
  ) {
    const calendarItems = await this.getCalendar(customerId, {
      year,
      month,
    });

    const calendarMap: Record<string, any[]> = {};
    for (const item of calendarItems) {
      const dateStr = item.scheduledDate || (item.date ? new Date(item.date).toISOString().split('T')[0] : '');
      if (dateStr) {
        if (!calendarMap[dateStr]) {
          calendarMap[dateStr] = [];
        }
        calendarMap[dateStr].push({
          id: item.id,
          activity: item.title || item.notes || item.type,
          status: (item.status || 'pending').toLowerCase(),
          time: item.time || item.scheduledTime || '10:00 AM',
        });
      }
    }

    return {
      year,
      month,
      calendar: calendarMap,
    };
  }

  /**
   * Update intermediate task progress status
   */
  async updateTaskStatus(
    scopedCustomerId: number | string | undefined,
    workId: number | string,
    taskId: number | string,
    status: TaskStatus,
  ) {
    const numWorkId = Number(workId);
    const numTaskId = Number(taskId);

    await this.findOne(scopedCustomerId, numWorkId);

    const task = await this.prisma.workTask.findFirst({
      where: { id: numTaskId, workId: numWorkId },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found for work ${workId}`);
    }

    return this.prisma.workTask.update({
      where: { id: numTaskId },
      data: { status },
      include: {
        assignedTo: true,
      },
    });
  }
}
