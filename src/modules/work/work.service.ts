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

    // Date-only precision filtering to strictly match target day without timezone shifts
    const filteredItems = (targetYear && targetMonth && targetDay)
      ? items.filter((w) => {
          if (!w.scheduledDate) return false;
          const d = new Date(w.scheduledDate);
          const isUtcMatch =
            d.getUTCFullYear() === targetYear &&
            d.getUTCMonth() + 1 === targetMonth &&
            d.getUTCDate() === targetDay;
          const isLocalMatch =
            d.getFullYear() === targetYear &&
            d.getMonth() + 1 === targetMonth &&
            d.getDate() === targetDay;
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

      return {
        id: String(w.id),
        purchaseId: purchaseRef,
        productName: isLocked ? 'Schedule Locked' : prodName,
        serviceName: isLocked ? 'Schedule Locked' : prodName,
        planName: planName,
        title: isLocked ? 'Schedule Locked' : w.title,
        date: w.scheduledDate,
        scheduleDate: w.scheduledDate,
        time: startTime,
        startTime: startTime,
        endTime: endTime,
        type: isLocked ? 'LOCKED' : w.workType,
        status: isLocked ? 'LOCKED' : w.status,
        isLocked,
        lockMessage,
        customerId: String(w.customerId),
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

    // ─────────────────────────────────────────────────────────────────────────
    // Merge SubscriptionInstallment payment schedules into calendar result.
    // These are stored in a separate table and were previously omitted, causing
    // the calendar to show ONLY Reel Shoot Work records.
    // ─────────────────────────────────────────────────────────────────────────
    if (numCustomerId) {
      const installmentWhere: any = {
        customerId: numCustomerId,
        deletedAt: null,
      };

      // Apply same date window used for Work records
      if (where.scheduledDate) {
        // Map the Work scheduledDate filter to installment dueDate field
        installmentWhere.dueDate = where.scheduledDate;
      }

      const installments = await this.prisma.subscriptionInstallment.findMany({
        where: installmentWhere,
        orderBy: { dueDate: 'asc' },
        include: {
          customer: { select: { id: true, name: true } },
          subscription: { select: { id: true, plan: { select: { name: true } } } },
        },
      });

      // Apply same day-precision filter used for Work records
      const filteredInstallments = (targetYear && targetMonth && targetDay)
        ? installments.filter((inst) => {
            if (!inst.dueDate) return false;
            const d = new Date(inst.dueDate);
            const isUtcMatch =
              d.getUTCFullYear() === targetYear &&
              d.getUTCMonth() + 1 === targetMonth &&
              d.getUTCDate() === targetDay;
            const isLocalMatch =
              d.getFullYear() === targetYear &&
              d.getMonth() + 1 === targetMonth &&
              d.getDate() === targetDay;
            return isUtcMatch || isLocalMatch;
          })
        : installments;

      for (const inst of filteredInstallments) {
        const installmentLabel = inst.installmentNumber === 1
          ? `50% Advance Payment – Installment ${inst.installmentNumber}`
          : `Remaining 50% Payment – Installment ${inst.installmentNumber}`;
        const planName = inst.subscription?.plan?.name || (activeSubForCustomer?.plan?.name ?? 'Active Plan');
        result.push({
          id: `inst-${inst.id}`,
          purchaseId: `PUR-${String(inst.subscriptionId).padStart(3, '0')}`,
          productName: installmentLabel,
          serviceName: 'Payment Schedule',
          planName: planName,
          title: inst.title || installmentLabel,
          date: inst.dueDate,
          scheduleDate: inst.dueDate,
          time: '12:00 PM',
          startTime: '12:00 PM',
          endTime: '01:00 PM',
          type: 'PAYMENT',
          status: inst.status,
          isLocked: false,
          lockMessage: undefined,
          customerId: String(inst.customerId),
          customerName: inst.customer?.name || 'Customer',
          assignedToId: null,
          assignedEmployee: 'Finance Team',
          editorId: null,
          editorName: '—',
          team: 'Finance',
          notes: inst.notes || `Payment installment ${inst.installmentNumber} of ${inst.totalInstallments}. Amount due: ₹${inst.totalAmount?.toFixed(2) ?? '0.00'}`,
          outputUrl: null,
          feedback: null,
          revisionCount: 0,
        } as any);
      }

      this.logger.log(`[CALENDAR_RESULT] installment_events_added: ${filteredInstallments.length}`);
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

    // 2. Extract Reel Count dynamically from purchased plan / custom features
    const effectiveFeatures = targetSub.customFeatures || targetSub.plan.features || [];
    let reelCount = extractReelCount(effectiveFeatures);

    // Fallback: If no reels found, check generic deliverable quotas
    if (reelCount <= 0) {
      const deliverableQuotas = extractDeliverableQuotas(effectiveFeatures);
      const reelQuota = deliverableQuotas.find((q) => q.serviceName.toLowerCase().includes('reel'));
      if (reelQuota) {
        reelCount = reelQuota.totalQty;
      }
    }

    if (reelCount <= 0) {
      return {
        success: true,
        message: 'No Reel deliverable quotas configured in purchased plan.',
        createdCount: 0,
        schedules: [],
      };
    }

    const startDate = targetSub.startDate ? new Date(targetSub.startDate) : new Date();
    const endDate = targetSub.endDate ? new Date(targetSub.endDate) : new Date(startDate.getTime() + 30 * 86400000);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    this.logger.log(
      `[PLAN_SCHEDULE_GENERATION] customerId: CUST-${numCustomerId} subscriptionId: SUB-${targetSub.id} planId: PLAN-${targetSub.planId} reelCount: ${reelCount} startDate: ${startDateStr} endDate: ${endDateStr}`,
    );

    // Generate dynamic Reel workflow activities (Shoot, Editing, Post)
    const reelActivities = generateReelWorkflowActivities(startDate, endDate, reelCount);

    // Log individual reel workflow dates
    for (let r = 1; r <= reelCount; r++) {
      const shootAct = reelActivities.find((a) => a.reelNumber === r && a.activityType === 'SHOOT');
      const editAct = reelActivities.find((a) => a.reelNumber === r && a.activityType === 'EDITING');
      const postAct = reelActivities.find((a) => a.reelNumber === r && a.activityType === 'POST');
      if (shootAct && editAct && postAct) {
        const shootStr = shootAct.scheduledDate.toISOString().split('T')[0];
        const editStr = editAct.scheduledDate.toISOString().split('T')[0];
        const postStr = postAct.scheduledDate.toISOString().split('T')[0];
        this.logger.log(`[REEL_${r}] shoot: ${shootStr} editing: ${editStr} post: ${postStr}`);
      }
    }

    let totalCreated = 0;

    const allGeneratedWorks = await this.prisma.$transaction(async (tx) => {
      // 1. Sync or provision PlanEntitlement for Reels
      let entitlement = await tx.planEntitlement.findFirst({
        where: { customerId: numCustomerId, serviceName: 'Reels' },
      });

      if (entitlement) {
        entitlement = await tx.planEntitlement.update({
          where: { id: entitlement.id },
          data: {
            planId: targetSub.planId,
            totalQty: reelCount,
            validUntil: endDate,
          },
        });
      } else {
        entitlement = await tx.planEntitlement.create({
          data: {
            customerId: numCustomerId,
            planId: targetSub.planId,
            serviceName: 'Reels',
            totalQty: reelCount,
            usedQty: 0,
            scheduledQty: 0,
            validUntil: endDate,
          },
        });
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
      if (existingWorks.length >= reelActivities.length) {
        return existingWorks;
      }

      const existingTitles = new Set(existingWorks.map((w) => w.title.toLowerCase().trim()));
      const createdItems: any[] = [];

      for (const act of reelActivities) {
        // Idempotency: Skip if activity with this title already exists for this subscription
        if (existingTitles.has(act.title.toLowerCase().trim())) {
          continue;
        }

        const createdWork = await tx.work.create({
          data: {
            customerId: numCustomerId,
            subscriptionId: targetSub.id,
            planId: targetSub.planId,
            entitlementId: entitlement.id,
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

      // Update entitlement scheduled count
      const activeCount = await tx.work.count({
        where: {
          customerId: numCustomerId,
          subscriptionId: targetSub.id,
          status: { not: WorkStatus.CANCELLED },
        },
      });

      await tx.planEntitlement.update({
        where: { id: entitlement.id },
        data: { scheduledQty: Math.min(activeCount, reelCount) },
      });

      return [...existingWorks, ...createdItems];
    });

    return {
      success: true,
      message: `Successfully generated ${totalCreated} Reel workflow activities for customer CUST-${numCustomerId}.`,
      createdCount: totalCreated,
      schedules: allGeneratedWorks,
    };
  }

  /**
   * Customer Reschedule existing schedule in-place.
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

    if (existing.status === WorkStatus.COMPLETED || existing.status === WorkStatus.CANCELLED) {
      throw new BadRequestException(`Cannot reschedule a work item with status ${existing.status}.`);
    }

    const newDate = new Date(dto.scheduledDate);
    if (isNaN(newDate.getTime())) {
      throw new BadRequestException('Invalid scheduledDate format.');
    }

    // Verify Active Plan Validity
    const activePlan = await this.getActivePlanDirect(numCustomerId);
    if (activePlan && activePlan.endDate && newDate > new Date(activePlan.endDate)) {
      throw new BadRequestException('Cannot reschedule past your plan expiration date.');
    }

    // Validate Sunday / working day rule
    if (newDate.getDay() === 0) {
      const customerPolicy = await this.prisma.attendancePolicy.findFirst({
        where: { customerId: numCustomerId, isActive: true },
      });
      if (customerPolicy && customerPolicy.workingDaysPerWeek <= 5) {
        throw new BadRequestException('Rescheduling is not allowed on Sundays according to working calendar policy.');
      }
    }

    const updated = await this.prisma.work.update({
      where: { id: numId },
      data: {
        scheduledDate: newDate,
        scheduledTime: dto.scheduledTime || existing.scheduledTime || '11:00 AM',
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

    // Notify assigned staff if present
    const staffUserIds = [updated.assignedTo?.userId, updated.editor?.userId].filter(Boolean) as number[];
    for (const uid of staffUserIds) {
      await this.prisma.notification.create({
        data: {
          customerId: updated.customerId,
          userId: uid,
          title: 'Schedule Updated by Customer',
          message: `Customer rescheduled "${updated.title}" to ${newDate.toLocaleDateString()} at ${updated.scheduledTime}.`,
          type: 'SCHEDULE_RESCHEDULED',
          data: { workId: updated.id, newDate: updated.scheduledDate },
        },
      });
    }

    return {
      success: true,
      message: 'Schedule updated successfully.',
      work: updated,
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

