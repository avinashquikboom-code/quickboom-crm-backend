import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkDto, UpdateWorkDto, SubmitWorkDto, ReviewWorkDto, AssignWorkDto } from './dto/work.dto';
import { WorkType, WorkStatus, TaskStatus } from '@prisma/client';
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

    if (scopedCustomerId && !isNaN(Number(scopedCustomerId)) && Number(scopedCustomerId) > 0) {
      where.customerId = Number(scopedCustomerId);
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

      // Create Work deliverable record
      const work = await tx.work.create({
        data: {
          customerId: numCustomerId,
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
    const where: any = {};

    let numCustomerId: number | undefined;
    if (scopedCustomerId && !isNaN(Number(scopedCustomerId)) && Number(scopedCustomerId) > 0) {
      numCustomerId = Number(scopedCustomerId);
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
    if (query.date) {
      const parts = query.date.split('-').map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        const [y, m, day] = parts;
        queriedDate = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
        const startOfDay = new Date(Date.UTC(y, m - 1, day, 0, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(y, m - 1, day, 23, 59, 59, 999));
        where.scheduledDate = { gte: startOfDay, lte: endOfDay };
      } else {
        const d = new Date(query.date);
        if (!isNaN(d.getTime())) {
          queriedDate = d;
          const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
          const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
          where.scheduledDate = { gte: startOfDay, lte: endOfDay };
        }
      }
    } else if (query.month && query.year) {
      const startOfMonth = new Date(Date.UTC(query.year, query.month - 1, 1, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999));
      where.scheduledDate = { gte: startOfMonth, lte: endOfMonth };
    } else if (query.dateFrom || query.dateTo) {
      where.scheduledDate = {};
      if (query.dateFrom) where.scheduledDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.scheduledDate.lte = new Date(query.dateTo);
    }

    const items = await this.prisma.work.findMany({
      where,
      orderBy: { scheduledDate: 'asc' },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        team: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        editor: { select: { id: true, firstName: true, lastName: true } },
        entitlement: true,
      },
    });

    const result = items.map((w) => ({
      id: String(w.id),
      title: w.title,
      date: w.scheduledDate,
      time: w.scheduledTime || '10:00 AM',
      type: w.workType,
      serviceName: w.entitlement?.serviceName || w.workType,
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
    }));

    // If a specific customer and date was queried, check if their active subscription started on that day
    if (numCustomerId && queriedDate) {
      const activeSub = await this.prisma.customerSubscription.findFirst({
        where: { customerId: numCustomerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { plan: true, customer: true },
      });

      if (activeSub && activeSub.startDate) {
        const subStart = new Date(activeSub.startDate);
        const isSameDay =
          (subStart.getUTCFullYear() === queriedDate.getUTCFullYear() &&
            subStart.getUTCMonth() === queriedDate.getUTCMonth() &&
            subStart.getUTCDate() === queriedDate.getUTCDate()) ||
          (subStart.getFullYear() === queriedDate.getFullYear() &&
            subStart.getMonth() === queriedDate.getMonth() &&
            subStart.getDate() === queriedDate.getDate());

        if (isSameDay) {
          const hasPlanEvent = result.some(
            (r) =>
              r.title.toLowerCase().includes('plan started') ||
              r.title.toLowerCase().includes('subscription'),
          );
          if (!hasPlanEvent) {
            result.unshift({
              id: `sub-start-${activeSub.id}`,
              title: `${activeSub.plan?.name || 'Active Plan'} Started`,
              date: subStart,
              time: '09:00 AM',
              type: 'SOCIAL_MEDIA_MANAGEMENT' as any,
              serviceName: 'Plan Activation',
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

    this.logger.log(
      `[CALENDAR_SERVICE] Customer ID: ${numCustomerId ?? 'ALL'} | Date: ${query.date ?? 'ALL'} | Schedules Found: ${items.length} | Total Events Returned: ${result.length}`,
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
    if (!activePlan.isActive || activePlan.isExpired) {
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
    const totalDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

    let totalCreated = 0;

    const allGeneratedWorks = await this.prisma.$transaction(async (tx) => {
      const createdItems: any[] = [];

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

        // Determine WorkType from service name
        let workType: WorkType = WorkType.REELS_SHOOT;
        const sNameLower = ent.serviceName.toLowerCase();
        if (sNameLower.includes('reel')) {
          workType = WorkType.REELS_SHOOT;
        } else if (sNameLower.includes('post') || sNameLower.includes('creative')) {
          workType = WorkType.POST_DESIGN;
        } else if (sNameLower.includes('story') || sNameLower.includes('stories')) {
          workType = WorkType.STORY_DESIGN;
        } else if (sNameLower.includes('influencer')) {
          workType = WorkType.INFLUENCER_PROMO;
        } else if (sNameLower.includes('video') || sNameLower.includes('edit')) {
          workType = WorkType.VIDEO_EDITING;
        } else if (sNameLower.includes('ad') || sNameLower.includes('meta') || sNameLower.includes('google')) {
          workType = WorkType.META_ADS;
        } else if (sNameLower.includes('social')) {
          workType = WorkType.SOCIAL_MEDIA_MANAGEMENT;
        }

        // Distribute schedule dates across plan duration
        const stepInterval = Math.max(2, Math.floor(totalDays / (ent.totalQty + 1)));

        for (let i = 0; i < missingQty; i++) {
          const sequenceNumber = existingWorks.length + i + 1;
          const dayOffset = Math.min(totalDays - 1, (sequenceNumber * stepInterval));
          const targetDate = new Date(startDate.getTime() + dayOffset * 86400000);

          // Avoid Sunday (day 0)
          if (targetDate.getDay() === 0) {
            targetDate.setDate(targetDate.getDate() + 1);
          }

          const work = await tx.work.create({
            data: {
              customerId: numCustomerId,
              planId: ent.planId || activePlan.planId,
              entitlementId: ent.id,
              workType,
              title: `${ent.serviceName} #${sequenceNumber}`,
              description: `System-generated schedule for ${ent.serviceName} (Sequence #${sequenceNumber} of ${ent.totalQty})`,
              scheduledDate: targetDate,
              scheduledTime: '11:00 AM',
              priority: 'MEDIUM',
              status: WorkStatus.SCHEDULED,
            },
          });

          // Create standard sub-tasks
          if (workType === WorkType.REELS_SHOOT) {
            await tx.workTask.createMany({
              data: [
                { workId: work.id, title: '1. Reel Shoot', stepOrder: 1, status: TaskStatus.PENDING },
                { workId: work.id, title: '2. Video Editing', stepOrder: 2, status: TaskStatus.PENDING },
                { workId: work.id, title: '3. Customer Review', stepOrder: 3, status: TaskStatus.PENDING },
                { workId: work.id, title: '4. Final Upload', stepOrder: 4, status: TaskStatus.PENDING },
              ],
            });
          } else {
            await tx.workTask.createMany({
              data: [
                { workId: work.id, title: '1. Content Design / Draft', stepOrder: 1, status: TaskStatus.PENDING },
                { workId: work.id, title: '2. Customer Review', stepOrder: 2, status: TaskStatus.PENDING },
                { workId: work.id, title: '3. Publishing / Upload', stepOrder: 3, status: TaskStatus.PENDING },
              ],
            });
          }

          createdItems.push(work);
          totalCreated++;
        }

        // Update entitlement scheduledQty
        const activeCount = await tx.work.count({
          where: {
            customerId: numCustomerId,
            entitlementId: ent.id,
            status: { in: [WorkStatus.SCHEDULED, WorkStatus.ASSIGNED, WorkStatus.IN_PROGRESS, WorkStatus.CUSTOMER_REVIEW, WorkStatus.REVISION_REQUESTED] },
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
      message: `Successfully verified and generated ${totalCreated} plan schedules.`,
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

