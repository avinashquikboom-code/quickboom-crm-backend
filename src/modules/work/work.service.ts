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
import { PlanAccessService } from '../subscription/plan-access.service';

@Injectable()
export class WorkService {
  private readonly logger = new Logger(WorkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planAccessService: PlanAccessService,
  ) {}

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
    const activePlan = await this.planAccessService.getEffectivePlan(numCustomerId);
    if (!activePlan.isActive || activePlan.isExpired) {
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
    if (numCustomerId) {
      where.customerId = numCustomerId;
    }

    if (query.employeeId && !isNaN(Number(query.employeeId))) {
      where.OR = [
        { assignedToId: Number(query.employeeId) },
        { editorId: Number(query.employeeId) },
      ];
    }

    if (query.status) where.status = query.status;

    let queriedDate: Date | undefined;
    let targetYear: number | undefined;
    let targetMonth: number | undefined;
    let targetDay: number | undefined;

    if (query.date) {
      const parts = query.date.split('-').map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        const [y, m, day] = parts;
        targetYear = y;
        targetMonth = m;
        targetDay = day;
        queriedDate = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
        // Expand query window by ±14 hours to catch any timezone-offset timestamps stored in DB
        const startWindow = new Date(Date.UTC(y, m - 1, day - 1, 10, 0, 0, 0));
        const endWindow = new Date(Date.UTC(y, m - 1, day + 1, 14, 0, 0, 0));
        where.scheduledDate = { gte: startWindow, lte: endWindow };
      } else {
        const d = new Date(query.date);
        if (!isNaN(d.getTime())) {
          queriedDate = d;
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

    // Target single date or range
    const queryStart = Date.now();
    this.logger.debug(`[CALENDAR_QUERY_START] customerId=${numCustomerId}, date=${query.date}`);
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
    this.logger.debug(`[CALENDAR_QUERY_END] main query took ${Date.now() - queryStart}ms, returned ${items.length} items`);

    // Filter items to strictly match the requested day in either UTC or local representation
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

    const result = filteredItems.map((w) => {
      const purchaseRef = w.subscriptionId
        ? `PUR-${String(w.subscriptionId).padStart(3, '0')}`
        : (w.subscription?.id ? `PUR-${String(w.subscription.id).padStart(3, '0')}` : `PUR-${String(w.customerId).padStart(3, '0')}`);
      const startTime = w.scheduledTime || '10:00 AM';
      const endTime = '11:00 AM';
      const prodName = w.entitlement?.serviceName || w.title || w.workType;
      return {
        id: String(w.id),
        purchaseId: purchaseRef,
        productName: prodName,
        serviceName: prodName,
        title: w.title,
        date: w.scheduledDate,
        scheduleDate: w.scheduledDate,
        time: startTime,
        startTime: startTime,
        endTime: endTime,
        type: w.workType,
        status: w.status,
        customerId: String(w.customerId),
        customerName: w.customer?.name || 'Customer',
        assignedToId: w.assignedToId,
        assignedEmployee: w.assignedTo ? `${w.assignedTo.firstName} ${w.assignedTo.lastName}`.trim() : 'Creative Lead',
        editorId: w.editorId,
        editorName: w.editor ? `${w.editor.firstName} ${w.editor.lastName}`.trim() : 'Editor',
        team: w.team?.name || 'SSM Team A',
        notes: w.description || w.notes || `${w.title} deliverable`,
        outputUrl: w.outputUrl,
        feedback: w.feedback,
        revisionCount: w.revisionCount,
      };
    });

    // Inject active subscription start event if applicable
    if (numCustomerId) {
      const subStart = Date.now();
      const activeSub = await this.prisma.customerSubscription.findFirst({
        where: { customerId: numCustomerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          startDate: true,
          plan: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });
      this.logger.debug(`[CALENDAR_SUB_QUERY] subscription lookup took ${Date.now() - subStart}ms`);

      if (activeSub && activeSub.startDate) {
        const subStart = new Date(activeSub.startDate);
        let shouldIncludeSubEvent = false;

        if (targetYear && targetMonth && targetDay) {
          const isSameDay =
            (subStart.getUTCFullYear() === targetYear &&
              subStart.getUTCMonth() + 1 === targetMonth &&
              subStart.getUTCDate() === targetDay) ||
            (subStart.getFullYear() === targetYear &&
              subStart.getMonth() + 1 === targetMonth &&
              subStart.getDate() === targetDay);
          shouldIncludeSubEvent = isSameDay;
        } else {
          // If no single date filter, always include plan start in all-activities list
          shouldIncludeSubEvent = true;
        }

        if (shouldIncludeSubEvent) {
          const hasPlanEvent = result.some(
            (r) =>
              r.title.toLowerCase().includes('plan started') ||
              r.title.toLowerCase().includes('subscription'),
          );
          if (!hasPlanEvent) {
            result.unshift({
              id: `sub-start-${activeSub.id}`,
              purchaseId: `PUR-${String(activeSub.id).padStart(3, '0')}`,
              productName: activeSub.plan?.name || 'Active Plan',
              serviceName: 'Plan Activation',
              title: `${activeSub.plan?.name || 'Active Plan'} Started`,
              date: subStart,
              scheduleDate: subStart,
              time: '09:00 AM',
              startTime: '09:00 AM',
              endTime: '10:00 AM',
              type: 'SOCIAL_MEDIA_MANAGEMENT' as any,
              status: WorkStatus.SCHEDULED,
              customerId: String(numCustomerId),
              customerName: activeSub.customer?.name || 'Customer',
              assignedToId: undefined,
              assignedEmployee: 'Account Manager',
              editorId: undefined,
              editorName: 'SSM Team',
              team: 'SSM Core Team',
              notes: `Active ${activeSub.plan?.name || 'Plan'} billing period started. All plan quotas and deliverables activated.`,
              outputUrl: null,
              feedback: null,
              revisionCount: 0,
            });
          }
        }
      }
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `[CALENDAR_DEBUG] authenticatedUserId: ${scopedCustomerId} | authenticatedCustomer: ${scopedCustomerId} | resolvedCustomerDbId: ${numCustomerId} | requestedDate: ${query.date ?? 'ALL'} | queryCustomerId: ${numCustomerId} | resultCount: ${result.length} | queryDurationMs: ${duration}`,
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
    const plan = await this.planAccessService.getEffectivePlan(numCustomerId);

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
      validUntil: e.validUntil || plan.endDate,
    }));

    return {
      planName: plan.planName,
      planCode: plan.planCode,
      billingCycle: plan.billingCycle,
      startDate: plan.startDate,
      endDate: plan.endDate,
      status: plan.status,
      price: plan.price,
      isExpired: plan.isExpired,
      services: serviceQuotas,
      totalLimit: plan.scheduleLimit,
      totalUsed: plan.usedSchedules,
      totalRemaining: plan.remainingSchedules,
    };
  }

  /**
   * Automatically generate plan deliverable schedules based on active plan entitlements.
   * Fully idempotent: only creates missing items, does not duplicate existing ones.
   */
  async generatePlanSchedules(customerId: number | string) {
    const numCustomerId = Number(customerId);
    if (!numCustomerId || isNaN(numCustomerId)) {
      throw new BadRequestException('Valid customer context required');
    }

    const activePlan = await this.planAccessService.getEffectivePlan(numCustomerId);
    if (!activePlan || !activePlan.isActive || activePlan.isExpired) {
      return {
        success: false,
        message: 'Cannot generate schedules. Plan is inactive or expired.',
        createdCount: 0,
        schedules: [],
      };
    }

    const entitlements = await this.prisma.planEntitlement.findMany({
      where: { customerId: numCustomerId },
      orderBy: { id: 'asc' },
    });

    if (entitlements.length === 0) {
      return {
        success: true,
        message: 'No entitlements found to generate schedules.',
        createdCount: 0,
        schedules: [],
      };
    }

    const startDate = activePlan.startDate ? new Date(activePlan.startDate) : new Date();
    const endDate = activePlan.endDate ? new Date(activePlan.endDate) : new Date(startDate.getTime() + 30 * 86400000);

    let totalCreated = 0;

    const allGeneratedWorks = await this.prisma.$transaction(async (tx) => {
      const createdItems: any[] = [];

      // Resolve active customer subscription / purchase
      const latestSub = await tx.customerSubscription.findFirst({
        where: { customerId: numCustomerId, deletedAt: null, status: SubscriptionStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });

      // Helper to advance date by 1 working day (skipping Sunday)
      const nextWorkingDay = (current: Date): Date => {
        const next = new Date(current);
        next.setDate(next.getDate() + 1);
        if (next.getDay() === 0) {
          next.setDate(next.getDate() + 1);
        }
        return next > endDate ? new Date(endDate) : next;
      };

      let scheduleCursor = new Date(startDate);
      if (scheduleCursor.getDay() === 0) {
        scheduleCursor.setDate(scheduleCursor.getDate() + 1);
      }

      for (const ent of entitlements) {
        if (ent.totalQty <= 0) continue;

        // Query existing non-cancelled work items for this entitlement
        const existingWorks = await tx.work.findMany({
          where: {
            customerId: numCustomerId,
            entitlementId: ent.id,
            status: { not: WorkStatus.CANCELLED },
          },
          orderBy: { id: 'asc' },
        });

        const missingQty = ent.totalQty - existingWorks.length;
        if (missingQty <= 0) {
          continue;
        }

        const sNameLower = ent.serviceName.toLowerCase();
        const isReel = sNameLower.includes('reel');
        const isCreativePost = sNameLower.includes('post') || sNameLower.includes('creative');
        const isStory = sNameLower.includes('story') || sNameLower.includes('stories');
        const isInfluencer = sNameLower.includes('influencer');

        for (let i = 0; i < missingQty; i++) {
          const sequenceNumber = existingWorks.length + i + 1;
          const targetDate = new Date(scheduleCursor);

          if (isReel) {
            // Workflow: Shoot (Day 0) -> Editing (Day +1) -> Final Upload (Day +2)
            const shootDate = new Date(scheduleCursor);
            const editDate = nextWorkingDay(shootDate);
            const uploadDate = nextWorkingDay(editDate);

            // 1. Reel - Shoot
            const shootWork = await tx.work.create({
              data: {
                customerId: numCustomerId,
                subscriptionId: latestSub?.id || null,
                planId: ent.planId || activePlan.planId,
                entitlementId: ent.id,
                workType: WorkType.REELS_SHOOT,
                title: `${ent.serviceName} #${sequenceNumber} - Shoot`,
                description: `Scripting & On-Location / Studio Shoot for ${ent.serviceName} #${sequenceNumber}`,
                scheduledDate: shootDate,
                scheduledTime: '11:00 AM',
                priority: 'HIGH',
                status: WorkStatus.SCHEDULED,
              },
            });
            await tx.workTask.createMany({
              data: [
                { workId: shootWork.id, title: '1. Script & Audio Selection', stepOrder: 1, status: TaskStatus.PENDING },
                { workId: shootWork.id, title: '2. Video Shoot & Footage Capture', stepOrder: 2, status: TaskStatus.PENDING },
              ],
            });
            createdItems.push(shootWork);
            totalCreated++;

            // 2. Reel - Video Editing
            const editWork = await tx.work.create({
              data: {
                customerId: numCustomerId,
                subscriptionId: latestSub?.id || null,
                planId: ent.planId || activePlan.planId,
                entitlementId: ent.id,
                workType: WorkType.VIDEO_EDITING,
                title: `${ent.serviceName} #${sequenceNumber} - Video Editing`,
                description: `Color Grading, Transitions, Captions & Sound Design for ${ent.serviceName} #${sequenceNumber}`,
                scheduledDate: editDate,
                scheduledTime: '02:00 PM',
                priority: 'MEDIUM',
                status: WorkStatus.SCHEDULED,
              },
            });
            await tx.workTask.createMany({
              data: [
                { workId: editWork.id, title: '1. Rough Cut & Color Grade', stepOrder: 1, status: TaskStatus.PENDING },
                { workId: editWork.id, title: '2. Sound Design & Typography', stepOrder: 2, status: TaskStatus.PENDING },
                { workId: editWork.id, title: '3. Customer Review Draft', stepOrder: 3, status: TaskStatus.PENDING },
              ],
            });
            createdItems.push(editWork);
            totalCreated++;

            // 3. Reel - Final Upload
            const uploadWork = await tx.work.create({
              data: {
                customerId: numCustomerId,
                subscriptionId: latestSub?.id || null,
                planId: ent.planId || activePlan.planId,
                entitlementId: ent.id,
                workType: WorkType.REEL,
                title: `${ent.serviceName} #${sequenceNumber} - Upload`,
                description: `Final Publishing, Trending Hashtag Optimization & Meta/Instagram Upload for ${ent.serviceName} #${sequenceNumber}`,
                scheduledDate: uploadDate,
                scheduledTime: '06:00 PM',
                priority: 'MEDIUM',
                status: WorkStatus.SCHEDULED,
              },
            });
            await tx.workTask.createMany({
              data: [
                { workId: uploadWork.id, title: '1. Hashtags & SEO Captions', stepOrder: 1, status: TaskStatus.PENDING },
                { workId: uploadWork.id, title: '2. Final Instagram / FB Upload', stepOrder: 2, status: TaskStatus.PENDING },
              ],
            });
            createdItems.push(uploadWork);
            totalCreated++;

            // Advance date cursor after Reel pipeline
            scheduleCursor = nextWorkingDay(uploadDate);
          } else if (isCreativePost) {
            const postWork = await tx.work.create({
              data: {
                customerId: numCustomerId,
                subscriptionId: latestSub?.id || null,
                planId: ent.planId || activePlan.planId,
                entitlementId: ent.id,
                workType: WorkType.POST_DESIGN,
                title: `${ent.serviceName} #${sequenceNumber}`,
                description: `Graphic Design & Carousel / Static Content Publishing for ${ent.serviceName} #${sequenceNumber}`,
                scheduledDate: targetDate,
                scheduledTime: '01:00 PM',
                priority: 'MEDIUM',
                status: WorkStatus.SCHEDULED,
              },
            });
            await tx.workTask.createMany({
              data: [
                { workId: postWork.id, title: '1. Graphic Design / Copywriting', stepOrder: 1, status: TaskStatus.PENDING },
                { workId: postWork.id, title: '2. Client Review & Approval', stepOrder: 2, status: TaskStatus.PENDING },
                { workId: postWork.id, title: '3. Publishing & Hashtag Setup', stepOrder: 3, status: TaskStatus.PENDING },
              ],
            });
            createdItems.push(postWork);
            totalCreated++;
            scheduleCursor = nextWorkingDay(scheduleCursor);
          } else if (isStory) {
            const storyWork = await tx.work.create({
              data: {
                customerId: numCustomerId,
                subscriptionId: latestSub?.id || null,
                planId: ent.planId || activePlan.planId,
                entitlementId: ent.id,
                workType: WorkType.STORY_DESIGN,
                title: `${ent.serviceName} #${sequenceNumber}`,
                description: `Interactive Story Design, Polls & Daily Updates for ${ent.serviceName} #${sequenceNumber}`,
                scheduledDate: targetDate,
                scheduledTime: '10:00 AM',
                priority: 'MEDIUM',
                status: WorkStatus.SCHEDULED,
              },
            });
            await tx.workTask.createMany({
              data: [
                { workId: storyWork.id, title: '1. Story Graphic / Motion Design', stepOrder: 1, status: TaskStatus.PENDING },
                { workId: storyWork.id, title: '2. Daily Story Publishing', stepOrder: 2, status: TaskStatus.PENDING },
              ],
            });
            createdItems.push(storyWork);
            totalCreated++;
            scheduleCursor = nextWorkingDay(scheduleCursor);
          } else if (isInfluencer) {
            const infWork = await tx.work.create({
              data: {
                customerId: numCustomerId,
                subscriptionId: latestSub?.id || null,
                planId: ent.planId || activePlan.planId,
                entitlementId: ent.id,
                workType: WorkType.INFLUENCER_PROMO,
                title: `${ent.serviceName} #${sequenceNumber}`,
                description: `Creator Collaboration, Briefing & Influencer Shoutout Execution for ${ent.serviceName} #${sequenceNumber}`,
                scheduledDate: targetDate,
                scheduledTime: '04:00 PM',
                priority: 'HIGH',
                status: WorkStatus.SCHEDULED,
              },
            });
            await tx.workTask.createMany({
              data: [
                { workId: infWork.id, title: '1. Influencer Briefing & Product Handover', stepOrder: 1, status: TaskStatus.PENDING },
                { workId: infWork.id, title: '2. Influencer Content Creation & Shoot', stepOrder: 2, status: TaskStatus.PENDING },
                { workId: infWork.id, title: '3. Brand Review & Approval', stepOrder: 3, status: TaskStatus.PENDING },
                { workId: infWork.id, title: '4. Influencer Posting & Tagging', stepOrder: 4, status: TaskStatus.PENDING },
              ],
            });
            createdItems.push(infWork);
            totalCreated++;
            scheduleCursor = nextWorkingDay(scheduleCursor);
          } else {
            const genericWork = await tx.work.create({
              data: {
                customerId: numCustomerId,
                subscriptionId: latestSub?.id || null,
                planId: ent.planId || activePlan.planId,
                entitlementId: ent.id,
                workType: WorkType.SOCIAL_MEDIA_MANAGEMENT,
                title: `${ent.serviceName} #${sequenceNumber}`,
                description: `Scheduled deliverable for ${ent.serviceName} #${sequenceNumber}`,
                scheduledDate: targetDate,
                scheduledTime: '11:00 AM',
                priority: 'MEDIUM',
                status: WorkStatus.SCHEDULED,
              },
            });
            createdItems.push(genericWork);
            totalCreated++;
            scheduleCursor = nextWorkingDay(scheduleCursor);
          }
        }

        // Update entitlement scheduledQty
        const activeCount = await tx.work.count({
          where: {
            customerId: numCustomerId,
            entitlementId: ent.id,
            status: { in: [WorkStatus.SCHEDULED, WorkStatus.ASSIGNED, WorkStatus.IN_PROGRESS, WorkStatus.CUSTOMER_REVIEW, WorkStatus.REVISION_REQUESTED, WorkStatus.COMPLETED, WorkStatus.APPROVED] },
          },
        });
        await tx.planEntitlement.update({
          where: { id: ent.id },
          data: { scheduledQty: activeCount },
        });
      }

      return createdItems;
    });

    return {
      success: true,
      message: `Successfully generated ${totalCreated} plan deliverable schedules for customer ${numCustomerId}.`,
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
    const activePlan = await this.planAccessService.getEffectivePlan(numCustomerId);
    if (activePlan.endDate && newDate > new Date(activePlan.endDate)) {
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

