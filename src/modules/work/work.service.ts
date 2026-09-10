import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkDto, UpdateWorkDto, SubmitWorkDto, ReviewWorkDto, AssignWorkDto } from './dto/work.dto';
import { WorkType, WorkStatus, TaskStatus, SubscriptionStatus, SubscriptionBillingCycle } from '@prisma/client';
import {
  extractDeliverableQuotas,
  extractReelCount,
  generateReelWorkflowActivities,
  generateAllPlanWorkflowActivities,
} from '../../common/utils/plan-deliverable.util';
import { calculateSubscriptionDates } from '../../common/utils/subscription-date.util';
import { PlanScheduleGateway } from './plan-schedule.gateway';
import { WorkPermissionService, normalizeActivityType } from './work-permission.service';

@Injectable()
export class WorkService {
  private readonly logger = new Logger(WorkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workPermissionService: WorkPermissionService,
    @Optional() private readonly planScheduleGateway?: PlanScheduleGateway,
  ) {}

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
   * Self-contained active plan resolver using only PrismaService.
   * Replicates PlanAccessService.getEffectivePlan() without cross-module dependency.
   */
  private async getActivePlanDirect(customerId: number) {
    const sub = await this.prisma.customerSubscription.findFirst({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (!sub || !sub.plan) return null;

    const now = new Date();
    const isExpired =
      sub.status === SubscriptionStatus.EXPIRED ||
      (sub.endDate ? now > new Date(sub.endDate) : false);
    const isActive =
      sub.status === SubscriptionStatus.ACTIVE && !isExpired;

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
      }),
      this.prisma.work.count({ where }),
    ]);

    return {
      items,
      data: items,
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

      // Check if customer has an assigned employee to inherit
      const customerRecord = await tx.customer.findUnique({
        where: { id: numCustomerId },
        select: { id: true, assignedEmployeeId: true },
      });
      const resolvedAssignedToId = dto.assignedToId
        ? Number(dto.assignedToId)
        : (customerRecord?.assignedEmployeeId || null);

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

      if (dto.editorId) {
        const edId = Number(dto.editorId);
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

      // Create Work deliverable record
      const work = await tx.work.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: resolvedSubscriptionId,
          planId: activePlan.planId,
          entitlementId: entitlement.id,
          teamId: dto.teamId ? Number(dto.teamId) : null,
          assignedToId: resolvedAssignedToId,
          editorId: dto.editorId ? Number(dto.editorId) : null,
          workType: dto.workType,
          title: dto.title,
          description: dto.description,
          scheduledDate: schedDate,
          scheduledTime: dto.scheduledTime || '10:00 AM',
          priority: dto.priority || 'MEDIUM',
          status: resolvedAssignedToId ? WorkStatus.ASSIGNED : WorkStatus.SCHEDULED,
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
            { workId: work.id, title: 'Customer Review & Approval', stepOrder: 3, status: TaskStatus.PENDING },
            { workId: work.id, title: 'Social Media Feed Upload', stepOrder: 4, status: TaskStatus.PENDING },
          ],
        });
      } else {
        await tx.workTask.createMany({
          data: [
            { workId: work.id, title: 'Creative Post Design', stepOrder: 1, status: TaskStatus.PENDING, assignedToId: work.assignedToId },
            { workId: work.id, title: 'Captions & Hashtags', stepOrder: 2, status: TaskStatus.PENDING },
            { workId: work.id, title: 'Customer Review', stepOrder: 3, status: TaskStatus.PENDING },
            { workId: work.id, title: 'Publishing & Boosting', stepOrder: 4, status: TaskStatus.PENDING },
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

      return tx.work.update({
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
    });

    this.emitRealtimeScheduleEvent(result.customerId, 'PLAN_SCHEDULE_UPDATED', {
      scheduleId: result.id,
      planId: result.subscriptionId,
      date: result.scheduledDate ? new Date(result.scheduledDate).toISOString().split('T')[0] : undefined,
    });

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

    return this.prisma.$transaction(async (tx) => {
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

      // 4. Notify assigned staff
      const staffUserIds = [work.assignedTo?.userId, work.editor?.userId].filter(Boolean) as number[];
      for (const uid of staffUserIds) {
        await tx.notification.create({
          data: {
            customerId: work.customerId,
            userId: uid,
            title: 'Work Approved!',
            message: `Customer approved final content for "${work.title}". Deliverable marked COMPLETED.`,
            type: 'WORK_APPROVED',
            data: { workId: work.id },
          },
        });
      }

      return {
        success: true,
        message: 'Content approved successfully! Schedule is now completed.',
        work,
      };
    });
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
    const where: any = {};
    let numCustomerId = this.resolveCustomerId(scopedCustomerId);
    if (!numCustomerId && scopedCustomerId) {
      const rawStr = String(scopedCustomerId).trim();
      const byAttr = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { domain: rawStr },
            { email: rawStr },
            { name: { equals: rawStr, mode: 'insensitive' } },
            { phone: rawStr },
          ],
          deletedAt: null,
        },
        select: { id: true },
      });
      if (byAttr) numCustomerId = byAttr.id;
    }

    let activeSubForCustomer: any = null;
    if (numCustomerId) {
      activeSubForCustomer = await this.prisma.customerSubscription.findFirst({
        where: { customerId: numCustomerId, deletedAt: null, status: SubscriptionStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      });

      // Strict Active Plan Rule:
      // If customer has no active subscription, return 0 schedules
      if (!activeSubForCustomer) {
        this.logger.log(`[CALENDAR_DEBUG]
authenticatedCustomerId: CUST-${numCustomerId}
requestedDate: ${query.date || 'ALL'}
activePlanId: NONE
subscriptionId: NONE
returnedSchedules: 0`);
        this.logger.log(
          `[CALENDAR_NO_ACTIVE_SUB] customerId: CUST-${numCustomerId} has no active plan. Returning 0 schedules.`,
        );
        return [];
      }

      // Filter exclusively by this customer's active subscription ID
      where.customerId = numCustomerId;
      where.subscriptionId = activeSubForCustomer.id;

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
        customer: { select: { id: true, name: true, address: true, city: true, state: true } },
        team: { select: { name: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        editor: { select: { id: true, firstName: true, lastName: true } },
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
          if (!w.scheduledDate) return false;
          const raw = w.scheduledDate;
          const str = typeof raw === 'string' ? raw : (raw instanceof Date ? raw.toISOString() : String(raw));
          const datePart = str.includes('T') ? str.split('T')[0] : str.split(' ')[0];
          const [y, m, d] = datePart.split('-').map(Number);
          if (y === targetYear && m === targetMonth && d === targetDay) return true;

          const dateObj = new Date(w.scheduledDate);
          if (isNaN(dateObj.getTime())) return false;
          const isUtcMatch =
            dateObj.getUTCFullYear() === targetYear &&
            dateObj.getUTCMonth() + 1 === targetMonth &&
            dateObj.getUTCDate() === targetDay;
          const isLocalMatch =
            dateObj.getFullYear() === targetYear &&
            dateObj.getMonth() + 1 === targetMonth &&
            dateObj.getDate() === targetDay;
          return isUtcMatch || isLocalMatch;
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

      const schedDateVal = w.scheduledDate
        ? (w.scheduledDate instanceof Date
            ? w.scheduledDate.toISOString().split('T')[0]
            : String(w.scheduledDate).split('T')[0])
        : null;

      const normalizedType = normalizeActivityType(w);

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
        assignedToId: w.assignedToId,
        assignedEmployee: isLocked
          ? '—'
          : (w.assignedTo
              ? `${w.assignedTo.firstName} ${w.assignedTo.lastName}`.trim()
              : (w.editor
                  ? `${w.editor.firstName} ${w.editor.lastName}`.trim()
                  : (() => {
                      const t = (w.title || w.workType || '').toLowerCase();
                      if (t.includes('shoot') || t.includes('photo')) return 'Photographer';
                      if (t.includes('edit')) return 'Video Editor';
                      if (t.includes('post design') || t.includes('story design') || t.includes('design')) return 'Graphic Designer';
                      if (t.includes('post') || t.includes('publish')) return 'Social Media Manager';
                      return 'Creative Lead';
                    })())),
        assignedToName: isLocked
          ? '—'
          : (w.assignedTo
              ? `${w.assignedTo.firstName} ${w.assignedTo.lastName}`.trim()
              : 'Photographer'),
        editorId: w.editorId,
        editorName: isLocked ? '—' : (w.editor ? `${w.editor.firstName} ${w.editor.lastName}`.trim() : 'Video Editor'),
        team: w.team?.name || 'SSM Team A',
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
  ): number | null {
    if (!members || members.length === 0) {
      return leaderId || null;
    }

    const normalizedType = normalizeActivityType(act);

    const memberMatches = (m: any, keywords: string[]) => {
      const desName = (m.employee?.designation?.name || '').toLowerCase();
      const deptName = (m.employee?.department?.name || '').toLowerCase();
      const role = (m.role || '').toLowerCase();
      const combined = `${desName} ${deptName} ${role}`;
      return keywords.some((k) => combined.includes(k));
    };

    let eligibleMembers: typeof members = [];

    if (normalizedType === 'REEL_EDIT' || normalizedType === 'VIDEO_EDITING') {
      eligibleMembers = members.filter((m) => memberMatches(m, ['editor', 'video edit', 'editing', 'video']));
    } else if (normalizedType === 'POST_DESIGN') {
      eligibleMembers = members.filter((m) => memberMatches(m, ['graphic', 'design', 'designer', 'artist', 'creative']));
    } else if (normalizedType === 'STORY_DESIGN') {
      eligibleMembers = members.filter((m) => memberMatches(m, ['graphic', 'design', 'designer', 'story', 'creative']));
    } else if (normalizedType === 'REEL_SHOOT') {
      eligibleMembers = members.filter((m) => memberMatches(m, ['photo', 'camera', 'shoot', 'videographer', 'photographer']));
    } else if (normalizedType === 'REEL_POST' || normalizedType === 'STORY_POST') {
      eligibleMembers = members.filter((m) => memberMatches(m, ['social', 'media', 'manager', 'marketing', 'content', 'executive']));
    } else if (normalizedType === 'INFLUENCER_PROMO') {
      eligibleMembers = members.filter((m) => memberMatches(m, ['influencer', 'promo', 'pr', 'marketing']));
    }

    if (eligibleMembers.length > 0) {
      const chosen = eligibleMembers[roundRobinIndex % eligibleMembers.length];
      return chosen.employeeId;
    }

    // Fallback: Round-robin among all team members or leader
    if (members.length > 0) {
      const chosen = members[roundRobinIndex % members.length];
      return chosen.employeeId;
    }

    return leaderId || null;
  }

  /**
   * Synchronize and assign all unassigned or team-less activities for a customer to the customer's assigned team.
   * Matches activities to team members based on their designation/specialization.
   */
  async syncCustomerTeamWorkAssignments(
    customerId: number | string,
    teamId: number | string,
    txClient?: any,
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

    if (!team) {
      this.logger.warn(`syncCustomerTeamWorkAssignments: Team ${numTeamId} not found.`);
      return 0;
    }

    // Find all works for this customer that are not cancelled and need assignment or team update
    const unassignedWorks = await prisma.work.findMany({
      where: {
        customerId: numCustomerId,
        status: { not: WorkStatus.CANCELLED },
        OR: [
          { assignedToId: null },
          { teamId: null },
          { teamId: { not: numTeamId } },
        ],
      },
      orderBy: { id: 'asc' },
    });

    if (unassignedWorks.length === 0) {
      return 0;
    }

    let updatedCount = 0;
    for (let i = 0; i < unassignedWorks.length; i++) {
      const work = unassignedWorks[i];
      const assignedEmpId =
        work.assignedToId ||
        this.resolveTeamMemberForActivity(work, team.members, team.leaderId, i);

      const newStatus =
        work.status === WorkStatus.SCHEDULED && assignedEmpId
          ? WorkStatus.ASSIGNED
          : work.status;

      await prisma.work.update({
        where: { id: work.id },
        data: {
          teamId: numTeamId,
          assignedToId: assignedEmpId,
          status: newStatus,
        },
      });

      if (assignedEmpId) {
        // Also ensure tasks are associated with the employee
        await prisma.workTask.updateMany({
          where: { workId: work.id, assignedToId: null },
          data: { assignedToId: assignedEmpId },
        });
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
  ) {
    const startTime = Date.now();
    const numEmployeeId = Number(employeeId);
    if (!numEmployeeId || isNaN(numEmployeeId)) {
      return [];
    }

    // Auto-sync unassigned team works if employee belongs to any teams
    try {
      const employeeTeams = await this.prisma.teamMember.findMany({
        where: { employeeId: numEmployeeId },
        select: { teamId: true },
      });
      const ledTeams = await this.prisma.team.findMany({
        where: { leaderId: numEmployeeId },
        select: { id: true },
      });
      const allMyTeamIds = Array.from(
        new Set([
          ...employeeTeams.map((t) => t.teamId),
          ...ledTeams.map((t) => t.id),
        ]),
      );

      if (allMyTeamIds.length > 0) {
        const customersWithUnassignedWorks = await this.prisma.customer.findMany({
          where: {
            assignedTeamId: { in: allMyTeamIds },
            works: {
              some: {
                status: { not: WorkStatus.CANCELLED },
                assignedToId: null,
              },
            },
          },
          select: { id: true, assignedTeamId: true },
        });

        for (const c of customersWithUnassignedWorks) {
          if (c.assignedTeamId) {
            await this.syncCustomerTeamWorkAssignments(c.id, c.assignedTeamId);
          }
        }
      }
    } catch (syncErr: any) {
      this.logger.warn(`Auto-sync team works in getEmployeeCalendar warning: ${syncErr?.message}`);
    }

    // Resolve employee details for complete relationship mapping
    const empRecord = this.prisma.employee?.findUnique
      ? await this.prisma.employee.findUnique({
          where: { id: numEmployeeId },
          select: { id: true, userId: true, firstName: true, lastName: true, customerId: true },
        })
      : (this.prisma.employee?.findFirst
          ? await this.prisma.employee.findFirst({
              where: { id: numEmployeeId },
              select: { id: true, userId: true, firstName: true, lastName: true, customerId: true },
            })
          : null);

    // Resolve employee role and allowed activity types for role-based visibility
    const { role: empRole, allowedTypes, isFullAccess, isProductionManager } =
      await this.workPermissionService.getAllowedActivityTypesForEmployee(
        numEmployeeId,
        (empRecord as any)?.customerId,
      );

    const empFullName = empRecord ? `${empRecord.firstName} ${empRecord.lastName}`.trim() : null;
    const tenantCustomerId = (empRecord as any)?.customerId;

    let where: any;

    if (isProductionManager) {
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
        { assignedToId: numEmployeeId },
        { editorId: numEmployeeId },
        { tasks: { some: { assignedToId: numEmployeeId } } },
      ];

      if (empRecord?.userId) {
        orConditions.push(
          { assignedToId: empRecord.userId },
          { editorId: empRecord.userId },
          { tasks: { some: { assignedToId: empRecord.userId } } },
        );
      }

      // Direct 1-on-1 customer assignment fallback: activities belonging to customers directly assigned to this employee,
      // provided the activity is not explicitly assigned to a different staff member
      orConditions.push({
        customer: { assignedEmployeeId: numEmployeeId },
        assignedToId: null,
        editorId: null,
      });

      if (empFullName) {
        orConditions.push({
          customer: { assignedEmployee: { equals: empFullName, mode: 'insensitive' } },
          assignedToId: null,
          editorId: null,
        });
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

    if (query.date) {
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
    } else if (query.month && query.year) {
      targetYear = query.year;
      targetMonth = query.month;
      // Buffer by +/- 1 day on month edges to avoid timezone truncation
      const startOfMonth = new Date(Date.UTC(query.year, query.month - 1, 0, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(query.year, query.month, 2, 23, 59, 59, 999));
      where.scheduledDate = { gte: startOfMonth, lte: endOfMonth };
    } else if (query.dateFrom || query.dateTo || (query as any).startDate || (query as any).endDate) {
      where.scheduledDate = {};
      const from = query.dateFrom || (query as any).startDate;
      const to = query.dateTo || (query as any).endDate;
      if (from) where.scheduledDate.gte = new Date(new Date(from).getTime() - 24 * 60 * 60 * 1000);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.scheduledDate.lte = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
      }
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
            assignedEmployee: true,
            assignedTeamId: true,
            assignedTeam: {
              select: { id: true, name: true },
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
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        editor: { select: { id: true, firstName: true, lastName: true } },
        entitlement: { select: { serviceName: true } },
        subscription: {
          select: {
            id: true,
            plan: { select: { name: true } },
          },
        },
        tasks: {
          select: { id: true, title: true, status: true, stepOrder: true, assignedToId: true, notes: true, createdAt: true },
          orderBy: { stepOrder: 'asc' },
        },
      },
    });

    // Timezone normalization helpers: check Direct String, UTC, Server Local, and IST (+05:30)
    const matchesTargetDate = (dateVal: any, tY: number, tM: number, tD: number): boolean => {
      if (!dateVal) return false;
      const rawStr = typeof dateVal === 'string' ? dateVal : (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal));
      const datePart = rawStr.includes('T') ? rawStr.split('T')[0] : rawStr.split(' ')[0];
      const [sy, sm, sd] = datePart.split('-').map(Number);
      if (sy === tY && sm === tM && sd === tD) return true;

      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return false;

      // UTC match
      if (d.getUTCFullYear() === tY && d.getUTCMonth() + 1 === tM && d.getUTCDate() === tD) return true;
      // Local server match
      if (d.getFullYear() === tY && d.getMonth() + 1 === tM && d.getDate() === tD) return true;
      // IST match (UTC + 05:30)
      const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      if (istDate.getUTCFullYear() === tY && istDate.getUTCMonth() + 1 === tM && istDate.getUTCDate() === tD) return true;

      return false;
    };

    const matchesTargetMonth = (dateVal: any, tY: number, tM: number): boolean => {
      if (!dateVal) return false;
      const rawStr = typeof dateVal === 'string' ? dateVal : (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal));
      const datePart = rawStr.includes('T') ? rawStr.split('T')[0] : rawStr.split(' ')[0];
      const [sy, sm] = datePart.split('-').map(Number);
      if (sy === tY && sm === tM) return true;

      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return false;

      // UTC match
      if (d.getUTCFullYear() === tY && d.getUTCMonth() + 1 === tM) return true;
      // Local server match
      if (d.getFullYear() === tY && d.getMonth() + 1 === tM) return true;
      // IST match (UTC + 05:30)
      const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      if (istDate.getUTCFullYear() === tY && istDate.getUTCMonth() + 1 === tM) return true;

      return false;
    };

    // Filter items according to queried date / month
    let filteredItems = items;
    if (targetYear && targetMonth && targetDay) {
      filteredItems = items.filter((w) => matchesTargetDate(w.scheduledDate, targetYear!, targetMonth!, targetDay!));
    } else if (targetYear && targetMonth) {
      filteredItems = items.filter((w) => matchesTargetMonth(w.scheduledDate, targetYear!, targetMonth!));
    }

    const formatScheduleDate = (dateVal: any, explicitTarget?: string): string => {
      if (explicitTarget && /^\d{4}-\d{2}-\d{2}$/.test(explicitTarget)) {
        const [y, m, d] = explicitTarget.split('-').map(Number);
        if (matchesTargetDate(dateVal, y, m, d)) {
          return explicitTarget;
        }
      }
      if (!dateVal) return '';
      const rawStr = typeof dateVal === 'string' ? dateVal : (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal));
      const directPart = rawStr.includes('T') ? rawStr.split('T')[0] : rawStr.split(' ')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(directPart)) {
        return directPart;
      }
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return '';
      const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      const y = istDate.getUTCFullYear();
      const m = String(istDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(istDate.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const mapped = filteredItems.map((w) => {
      const purchaseRef = w.subscriptionId
        ? `PUR-${String(w.subscriptionId).padStart(3, '0')}`
        : (w.subscription?.id ? `PUR-${String(w.subscription.id).padStart(3, '0')}` : `PUR-${String(w.customerId).padStart(3, '0')}`);
      const startTime = w.scheduledTime || '10:00 AM';
      const endTime = '11:00 AM';
      const prodName = w.entitlement?.serviceName || w.title || w.workType;
      const planName = w.subscription?.plan?.name || 'Active Plan';

      const schedDateVal = w.scheduledDate ? formatScheduleDate(w.scheduledDate, targetDateStr) : null;

      const customerLocation = [w.customer?.address, w.customer?.city, w.customer?.state]
        .filter(Boolean)
        .join(', ') || null;

      const assignedEmpList: string[] = [];
      if (w.assignedTo) {
        const atName = `${w.assignedTo.firstName} ${w.assignedTo.lastName}`.trim();
        if (atName) assignedEmpList.push(atName);
      }
      if (w.editor) {
        const edName = `${w.editor.firstName} ${w.editor.lastName}`.trim();
        if (edName && !assignedEmpList.includes(edName)) assignedEmpList.push(edName);
      }
      if (w.team?.members) {
        for (const tm of w.team.members) {
          if (tm.employee) {
            const memberName = `${tm.employee.firstName} ${tm.employee.lastName}`.trim();
            if (memberName && !assignedEmpList.includes(memberName)) assignedEmpList.push(memberName);
          }
        }
      }

      const assignedEmpName = w.assignedTo
        ? `${w.assignedTo.firstName} ${w.assignedTo.lastName}`.trim()
        : (w.editor
            ? `${w.editor.firstName} ${w.editor.lastName}`.trim()
            : (w.customer?.assignedEmployee || (empRecord && w.customer?.assignedEmployeeId === numEmployeeId ? `${empRecord.firstName} ${empRecord.lastName}`.trim() : 'Staff')));

      const smHandler = w.customer?.socialMediaHandlers?.[0];
      const platform = smHandler?.platform || 'Instagram';
      const smAccount = smHandler?.accountName
        ? `${platform} — @${smHandler.accountName}`
        : (w.customer?.name ? `@${w.customer.name.toLowerCase().replace(/\s+/g, '')}` : 'Instagram');

      const normalizedType = normalizeActivityType(w);

      return {
        id: String(w.id),
        activityId: String(w.id),
        customerId: String(w.customerId),
        customerName: w.customer?.name || 'Customer',
        customerBusiness: w.customer?.companyName || w.customer?.name || 'Customer',
        purchaseId: purchaseRef,
        productName: prodName,
        serviceName: prodName,
        planName: planName,
        title: w.title,
        scheduledDate: schedDateVal,
        scheduledAt: w.scheduledDate,
        scheduledTime: startTime,
        date: schedDateVal || w.scheduledDate,
        scheduleDate: schedDateVal || w.scheduledDate,
        time: startTime,
        startTime: startTime,
        endTime: endTime,
        type: normalizedType,
        activityType: normalizedType,
        workType: w.workType,
        status: w.status,
        location: customerLocation,
        canReschedule: false,
        canRequestRework: false,
        reworkActionLabel: null,
        isLocked: false,
        lockMessage: null,
        assignedToId: w.assignedToId || (w.customer?.assignedEmployeeId === numEmployeeId ? numEmployeeId : null),
        assignedEmployee: assignedEmpName,
        assignedToName: assignedEmpName,
        assignedEmployees: assignedEmpList.length > 0 ? assignedEmpList : (assignedEmpName ? [assignedEmpName] : []),
        editorId: w.editorId,
        editorName: w.editor ? `${w.editor.firstName} ${w.editor.lastName}`.trim() : null,
        teamId: w.teamId || w.customer?.assignedTeamId || null,
        team: w.team?.name || w.customer?.assignedTeam?.name || null,
        assignedTeam: w.team?.name || w.customer?.assignedTeam?.name || null,
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

    // Enforce role-based activity visibility: only activities supported by the employee's role/permissions
    const result = isFullAccess
      ? mapped
      : mapped.filter((item) => allowedTypes.has(item.activityType));

    this.logger.log(`[EMPLOYEE_CALENDAR_ROLE_FILTER]
employeeId: ${employeeId}
role: ${empRole}
isFullAccess: ${isFullAccess}
allowedTypes: ${Array.from(allowedTypes).join(', ')}
beforeFilter: ${mapped.length}
afterFilter: ${result.length}`);

    this.logger.log(`[EMPLOYEE_CALENDAR_DEBUG]
employeeId: ${employeeId}
selectedDate: ${targetDateStr || 'ALL'}
month: ${query.month || 'ALL'}
year: ${query.year || 'ALL'}
returnedCount: ${result.length}
durationMs: ${Date.now() - startTime}`);

    for (const item of result) {
      this.logger.log(`[EMPLOYEE_CALENDAR_ITEM]
activityId: ${item.id}
purchaseId: ${item.purchaseId}
customer: ${item.customerName}
type: ${item.activityType}
scheduledDate: ${item.scheduledDate}
time: ${item.time}
status: ${item.status}
assignedEmployee: ${item.assignedEmployee}`);
    }

    return result;
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
  ) {
    const works = await this.getEmployeeCalendar(employeeId, query);

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
    const works = await this.getEmployeeCalendar(employeeId, {});
    const customerMap = new Map<number, string>();
    const employeeMap = new Map<number, string>();
    const teamMap = new Map<number, string>();

    for (const w of works) {
      if (w.customerId && w.customerName) {
        customerMap.set(Number(w.customerId), w.customerName);
      }
      if (w.assignedToId && w.assignedEmployee) {
        employeeMap.set(Number(w.assignedToId), w.assignedEmployee);
      }
      if (w.editorId && w.editorName) {
        employeeMap.set(Number(w.editorId), w.editorName);
      }
      if (w.assignedTeam) {
        const tId = Number(w.teamId || 0);
        if (tId > 0) {
          teamMap.set(tId, w.assignedTeam);
        }
      }
    }

    const numEmployeeId = Number(employeeId);
    const emp = await this.prisma.employee.findUnique({
      where: { id: numEmployeeId },
      select: { customerId: true },
    });

    if (emp?.customerId) {
      const allEmps = await this.prisma.employee.findMany({
        where: { customerId: emp.customerId, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true },
      });
      for (const e of allEmps) {
        const name = `${e.firstName} ${e.lastName}`.trim();
        if (name && !employeeMap.has(e.id)) {
          employeeMap.set(e.id, name);
        }
      }

      const allTeams = await this.prisma.team.findMany({
        where: { customerId: emp.customerId, isActive: true },
        select: { id: true, name: true },
      });
      for (const t of allTeams) {
        if (t.name && !teamMap.has(t.id)) {
          teamMap.set(t.id, t.name);
        }
      }

      const allCustomers = await this.prisma.customer.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true, companyName: true },
        take: 100,
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
    if (user.employee?.id) return Number(user.employee.id);
    if (user.employeeId) return Number(user.employeeId);

    const rawId = Number(user.id);
    const email = user.email ? String(user.email).trim().toLowerCase() : undefined;
    const phone = user.phone ? String(user.phone).trim() : undefined;

    const orConditions: any[] = [];
    if (!isNaN(rawId) && rawId > 0) {
      orConditions.push({ userId: rawId });
      orConditions.push({ id: rawId });
    }
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
      planName: plan?.planName ?? 'Active Plan',
      planCode: plan?.planCode ?? 'CUSTOM',
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

      // If full set of activities already generated for this subscription, do NOT duplicate
      if (existingWorks.length >= planActivities.length) {
        return existingWorks;
      }

      const existingTitles = new Set(existingWorks.map((w) => w.title.toLowerCase().trim()));
      const createdItems: any[] = [];

      // Resolve team info if customer is assigned to a team
      const assignedTeamId = targetSub.customer?.assignedTeamId || null;
      let teamMembers: any[] = [];
      let teamLeaderId: number | null = null;
      if (assignedTeamId) {
        const team = await tx.team.findUnique({
          where: { id: assignedTeamId },
          include: {
            members: {
              include: {
                employee: {
                  select: {
                    id: true,
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
        if (team) {
          teamLeaderId = team.leaderId;
          teamMembers = team.members;
        }
      }

      for (const act of planActivities) {
        // Idempotency: Skip if activity with this title already exists for this subscription
        if (existingTitles.has(act.title.toLowerCase().trim())) {
          continue;
        }

        const entId = entitlementMap.get(act.serviceName.toLowerCase()) || null;

        const assignedEmpId =
          targetSub.customer?.assignedEmployeeId ||
          (assignedTeamId
            ? this.resolveTeamMemberForActivity(act, teamMembers, teamLeaderId, totalCreated)
            : null);

        const createdWork = await tx.work.create({
          data: {
            customerId: numCustomerId,
            subscriptionId: targetSub.id,
            planId: targetSub.planId,
            entitlementId: entId,
            teamId: assignedTeamId,
            assignedToId: assignedEmpId,
            workType: act.workType,
            title: act.title,
            description: act.description,
            scheduledDate: act.scheduledDate,
            scheduledTime: act.scheduledTime,
            priority: 'MEDIUM',
            status: assignedEmpId ? WorkStatus.ASSIGNED : WorkStatus.SCHEDULED,
          },
        });

        // Attach workflow task tracking with assigned employee
        await tx.workTask.createMany({
          data: [
            { workId: createdWork.id, title: `1. Asset & Content Preparation`, stepOrder: 1, status: TaskStatus.PENDING, assignedToId: assignedEmpId },
            { workId: createdWork.id, title: `2. Review & Client Approval`, stepOrder: 2, status: TaskStatus.PENDING, assignedToId: assignedEmpId },
            { workId: createdWork.id, title: `3. Final Deliverable Execution`, stepOrder: 3, status: TaskStatus.PENDING, assignedToId: assignedEmpId },
          ],
        });

        createdItems.push(createdWork);
        totalCreated++;
      }

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

    const updated = await this.prisma.work.update({
      where: { id: numWorkId },
      data: {
        status: WorkStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    this.emitRealtimeScheduleEvent(existing.customerId, 'SCHEDULE_STATUS_CHANGED', {
      scheduleId: updated.id,
      status: 'completed',
    });

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

