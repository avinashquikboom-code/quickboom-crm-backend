import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkDto, UpdateWorkDto, SubmitWorkDto, ReviewWorkDto, AssignWorkDto } from './dto/work.dto';
import { WorkType, WorkStatus, TaskStatus, SubscriptionStatus } from '@prisma/client';
import {
  extractDeliverableQuotas,
  extractReelCount,
  generateReelWorkflowActivities,
  generateAllPlanWorkflowActivities,
} from '../../common/utils/plan-deliverable.util';

@Injectable()
export class WorkService {
  private readonly logger = new Logger(WorkService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

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

    return this.prisma.$transaction(async (tx) => {
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

      // Create Work deliverable record
      const work = await tx.work.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: resolvedSubscriptionId,
          planId: activePlan.planId,
          entitlementId: entitlement.id,
          teamId: dto.teamId ? Number(dto.teamId) : null,
          assignedToId: dto.assignedToId ? Number(dto.assignedToId) : null,
          editorId: dto.editorId ? Number(dto.editorId) : null,
          workType: dto.workType,
          title: dto.title,
          description: dto.description,
          scheduledDate: schedDate,
          scheduledTime: dto.scheduledTime || '10:00 AM',
          priority: dto.priority || 'MEDIUM',
          status: dto.assignedToId ? WorkStatus.ASSIGNED : WorkStatus.SCHEDULED,
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
  }

  /**
   * Update work details, dates, or basic metadata.
   */
  async update(scopedCustomerId: number | string | undefined, id: number | string, dto: UpdateWorkDto) {
    const numId = Number(id);
    const existing = await this.findOne(scopedCustomerId, numId);

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

    return this.prisma.$transaction(async (tx) => {
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

    return this.prisma.$transaction(async (tx) => {
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
    const numCustomerId = this.resolveCustomerId(scopedCustomerId);
    let activeSubForCustomer: any = null;
    if (numCustomerId) {
      where.customerId = numCustomerId;
      activeSubForCustomer = await this.prisma.customerSubscription.findFirst({
        where: { customerId: numCustomerId, deletedAt: null, status: SubscriptionStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      });

      if (activeSubForCustomer) {
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
        customer: { select: { id: true, name: true } },
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
      const payments = await this.prisma.paymentHistory.findMany({
        where: { customerId: numCustomerId, status: 'SUCCESS' },
      });
      totalPaidForSub = Array.isArray(payments)
        ? payments.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0)
        : 0;
      const planBasePrice = Number(activeSubForCustomer.plan?.monthlyPrice || 0);
      const planTotalWithTax = Math.round(planBasePrice * 1.18);

      isFullyPaid = totalPaidForSub >= planTotalWithTax;
      isFirstInstallmentPaid = totalPaidForSub > 0;

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

      return {
        id: String(w.id),
        activityId: String(w.id),
        customerId: String(w.customerId),
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
        type: isLocked ? 'LOCKED' : w.workType,
        activityType: isLocked ? 'LOCKED' : w.workType,
        status: isLocked ? 'LOCKED' : w.status,
        canReschedule,
        canRequestRework,
        reworkActionLabel,
        isLocked,
        lockMessage,
        customerName: w.customer?.name || 'Customer',
        assignedToId: w.assignedToId,
        assignedEmployee: isLocked ? '—' : (w.assignedTo ? `${w.assignedTo.firstName} ${w.assignedTo.lastName}`.trim() : 'Creative Lead'),
        editorId: w.editorId,
        editorName: isLocked ? '—' : (w.editor ? `${w.editor.firstName} ${w.editor.lastName}`.trim() : 'Editor'),
        team: w.team?.name || 'SSM Team A',
        notes: isLocked
          ? (lockMessage || 'Complete the remaining 50% payment to unlock your second installation schedule.')
          : (w.description || w.notes || `${w.title} deliverable`),
        outputUrl: isLocked ? null : w.outputUrl,
        feedback: isLocked ? null : w.feedback,
        revisionCount: isLocked ? 0 : w.revisionCount,
      };
    });

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

    const startDate = targetSub.startDate ? new Date(targetSub.startDate) : new Date();
    const endDate = targetSub.endDate ? new Date(targetSub.endDate) : new Date(startDate.getTime() + 30 * 86400000);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    this.logger.log(
      `[PLAN_SCHEDULE_GENERATION] customerId: CUST-${numCustomerId} subscriptionId: SUB-${targetSub.id} planId: PLAN-${targetSub.planId} quotas: ${JSON.stringify(deliverableQuotas)} startDate: ${startDateStr} endDate: ${endDateStr}`,
    );

    // Generate dynamic workflow activities for ALL deliverable services
    const planActivities = generateAllPlanWorkflowActivities(startDate, endDate, deliverableQuotas);

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

      for (const act of planActivities) {
        // Idempotency: Skip if activity with this title already exists for this subscription
        if (existingTitles.has(act.title.toLowerCase().trim())) {
          continue;
        }

        const entId = entitlementMap.get(act.serviceName.toLowerCase()) || null;

        const createdWork = await tx.work.create({
          data: {
            customerId: numCustomerId,
            subscriptionId: targetSub.id,
            planId: targetSub.planId,
            entitlementId: entId,
            workType: act.workType,
            title: act.title,
            description: act.description,
            scheduledDate: act.scheduledDate,
            scheduledTime: act.scheduledTime,
            priority: 'MEDIUM',
            status: WorkStatus.SCHEDULED,
          },
        });

        // Attach workflow task tracking
        await tx.workTask.createMany({
          data: [
            { workId: createdWork.id, title: `1. Asset & Content Preparation`, stepOrder: 1, status: TaskStatus.PENDING },
            { workId: createdWork.id, title: `2. Review & Client Approval`, stepOrder: 2, status: TaskStatus.PENDING },
            { workId: createdWork.id, title: `3. Final Deliverable Execution`, stepOrder: 3, status: TaskStatus.PENDING },
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

    return {
      success: true,
      message: 'Rework request submitted successfully.',
      rework: reworkItem,
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

