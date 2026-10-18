import { GoneException } from '@nestjs/common';
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
import { Prisma, WorkType, WorkStatus, TaskStatus,  SubscriptionBillingCycle } from '@prisma/client';
import {
  extractDeliverableQuotas,
  extractReelCount,
  generateReelWorkflowActivities,
  generateAllPlanWorkflowActivities,
} from '../../common/utils/plan-deliverable.util';
import { calculateSubscriptionDates } from '../../common/utils/subscription-date.util';
import { PlanScheduleGateway } from './plan-schedule.gateway';
import { WorkAssignmentService, normalizeActivityType } from './work-assignment.service';
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

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly workPermissionService?: WorkAssignmentService,
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
  private async getActivePlanDirect(customerId: number) : Promise<never> {
throw new GoneException('Customer and Lead functionality has been removed');
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
return undefined;
  }

  /**
   * List work items with tenant/role scoping, status filtering, and pagination.
   */
  async findAll(
    scopedCustomerId?: number | string,
    query: {
      viewerEmployeeId?: number;
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

      ];
    }

    if (query.viewerEmployeeId) {
      const employeeId = query.viewerEmployeeId;
      where.AND = [{ OR: [
        { assignedToId: employeeId }, { editorId: employeeId },
        { tasks: { some: { assignedToId: employeeId } } },
        { team: { isActive: true, OR: [{ leaderId: employeeId }, { members: { some: { employeeId } } }] } },
      ] }];
    }

    const [items, total] = await Promise.all([
      this.prisma.work.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledDate: 'desc' },
        include: {

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

    }

    const work = await this.prisma.work.findFirst({
      where,
      include: {

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
const employee = await this.prisma.employee.findUnique({ where: { id: Number(employeeId) } });
if (!employee || employee.status !== 'ACTIVE') throw new ForbiddenException('Active employee profile required');
  }

  /**
   * Customer Create Schedule with atomic plan quota verification and reservation.
   */
  async create(scopedCustomerId: number | string, dto: CreateWorkDto) {
    const numCustomerId = Number(scopedCustomerId);
    const companyId = dto.companyId == null ? null : Number(dto.companyId);
    if (companyId !== null) {
      if (!Number.isSafeInteger(companyId) || companyId < 1)
        throw new BadRequestException('Invalid CRM company ID');
      const company = await this.prisma.company.findFirst({
        where: { id: companyId, deletedAt: null },
        select: { id: true },
      });
      if (!company) throw new NotFoundException('CRM company not found');
    }


    // 2. Validate Non-working Day / Sunday Rule
    const schedDate = new Date(dto.scheduledDate);
    if (isNaN(schedDate.getTime())) {
      throw new BadRequestException('Invalid scheduledDate format');
    }
    if (schedDate.getDay() === 0) { // 0 = Sunday
      const customerPolicy = await this.prisma.attendancePolicy.findFirst({
        where: {  isActive: true },
      });
      if (customerPolicy && customerPolicy.workingDaysPerWeek <= 5) {
        throw new BadRequestException('Scheduling is not allowed on Sundays according to working calendar policy.');
      }
    }

    // 3. Resolve Service Name and Check / Initialize Entitlement
    const serviceName = this.resolveServiceName(dto.workType, dto.serviceName);

    const result = await this.prisma.$transaction(async (tx) => {
      const entitlement = await tx.planEntitlement.findFirst({ where: { serviceName } });
      if (entitlement) {
        if (entitlement.validUntil && entitlement.validUntil < new Date()) throw new BadRequestException('Work entitlement has expired');
        const reserved = await tx.planEntitlement.updateMany({
          where: { id: entitlement.id, scheduledQty: entitlement.scheduledQty, usedQty: entitlement.usedQty },
          data: { scheduledQty: { increment: 1 } },
        });
        if (entitlement.usedQty + entitlement.scheduledQty >= entitlement.totalQty || reserved.count !== 1) throw new BadRequestException('Work quota exhausted or changed; retry');
      }
      const resolvedTeamId = dto.teamId ? Number(dto.teamId) : null;
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
            undefined,
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
              undefined,
            );
            if (editorEligibleIds.length > 0) {
              resolvedEditorId = editorEligibleIds[0];
            }
          }
        }
      }

      if (dto.workType === WorkType.EDITING && resolvedEditorId) {
        resolvedAssignedToId = resolvedEditorId;
      }

      if (resolvedAssignedToId) {
        const perm = await this.workPermissionService.getEmployeeActivityTypes(
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
            `Cannot assign activity '${dto.title || normalizedType}' to employee #${resolvedAssignedToId}. Their role '${perm.designation}' does not support '${normalizedType}'.`,
          );
        }
      }

      if (resolvedEditorId) {
        const edId = Number(resolvedEditorId);
        const perm = await this.workPermissionService.getEmployeeActivityTypes(
          edId,
          numCustomerId,
        );
        if (!perm.isFullAccess && !perm.allowedTypes.has('REEL_EDIT')) {
          throw new BadRequestException(
            `Cannot assign editor role to employee #${edId}. Their role '${perm.designation}' does not support Video Editing.`,
          );
        }
      }

      const workStatus = (resolvedAssignedToId || resolvedEditorId)
        ? WorkStatus.ASSIGNED
        : WorkStatus.SCHEDULED;

      // Create Work deliverable record
      const work = await tx.work.create({
        data: {


          companyId,
          planId: entitlement?.planId ?? null,
          entitlementId: entitlement?.id ?? null,
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
      const customerUser = work.assignedTo?.userId ? await tx.user.findFirst({ where: { id: work.assignedTo.userId, isActive: true, deletedAt: null } }) : null;
      if (customerUser) {
        await tx.notification.create({
          data: {

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

    this.emitRealtimeScheduleEvent(undefined, 'PLAN_SCHEDULE_CREATED', {
      scheduleId: result.id,
      planId: undefined,
      date: result.scheduledDate ? new Date(result.scheduledDate).toISOString().split('T')[0] : undefined,
    });

    // 9. CUSTOMER CALENDAR SCHEDULE -> CUSTOMER NOTIFICATION
    if (this.notificationService && undefined) {
      const assignedEmployeeName = result.assignedTo
        ? `${result.assignedTo.firstName || ''} ${result.assignedTo.lastName || ''}`.trim()
        : null;
      this.notificationService
        .sendCalendarScheduledNotification({

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
            ...(scopedCustomerId ? [] : []),
          ],
        },
      });
    }
    if (!existing) {
      existing = await this.findOne(scopedCustomerId, numId);
    }
    if (dto.assignedToId) {
      const targetEmpId = Number(dto.assignedToId);
      const perm = await this.workPermissionService.getEmployeeActivityTypes(targetEmpId, undefined);
      const normalizedType = normalizeActivityType(existing);
      if (!perm.isFullAccess && !perm.allowedTypes.has(normalizedType)) {
        throw new BadRequestException(
          `Cannot assign activity '${existing.title || normalizedType}' to employee #${targetEmpId}. Their role '${perm.designation}' does not support '${normalizedType}'.`,
        );
      }
    }
    if (dto.editorId) {
      const targetEditorId = Number(dto.editorId);
      const perm = await this.workPermissionService.getEmployeeActivityTypes(targetEditorId, undefined);
      if (!perm.isFullAccess && !perm.allowedTypes.has('REEL_EDIT')) {
        throw new BadRequestException(
          `Cannot assign editor role to employee #${targetEditorId}. Their role '${perm.designation}' does not support Video Editing.`,
        );
      }
    }

    const updateData: any = {};
    if (dto.companyId !== undefined) {
      const companyId = dto.companyId === null ? null : Number(dto.companyId);
      if (companyId !== null) {
        if (!Number.isSafeInteger(companyId) || companyId < 1)
          throw new BadRequestException('Invalid CRM company ID');
        const company = await this.prisma.company.findFirst({
          where: { id: companyId, deletedAt: null },
          select: { id: true },
        });
        if (!company) throw new NotFoundException('CRM company not found');
      }
      updateData.companyId = companyId;
    }
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

    this.emitRealtimeScheduleEvent(undefined, 'PLAN_SCHEDULE_UPDATED', {
      scheduleId: result.id,
      planId: undefined,
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

            title: '🚀 Work Started',
            body: `${employeeName} has started working on "${workTitle}". Status: In Progress (${startDateTime}).`,
            type: 'WORK_STARTED',
            data: {
              type: 'WORK',
              workId: String(result.id),

              employeeName,
              workTitle,
              status: 'IN_PROGRESS',
              startDateTime,
            },
          });
          this.logger.log(`Dispatched WORK_STARTED notification to customer #${undefined} for work #${result.id}`);
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

    const customerName = null;
    const wasCancelled = existing.status !== WorkStatus.CANCELLED && result.status === WorkStatus.CANCELLED;
    const assigneeChanged = dto.assignedToId !== undefined && Number(dto.assignedToId) !== Number(existing.assignedToId);

    if (this.notificationService && result.assignedToId && (isRescheduled || wasCancelled)) {
      this.notificationService
        .sendTaskRescheduledNotification({

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
      const customerUser = work.assignedTo?.userId ? await tx.user.findFirst({ where: { id: work.assignedTo.userId, isActive: true, deletedAt: null } }) : null;
      if (customerUser) {
        await tx.notification.create({
          data: {

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

    if (this.notificationService && undefined) {
      try {
        await this.notificationService.sendPushNotification({

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

          assignedTo: true,
          editor: true,
        },
      });

      // Notify editor / assigned employee
      const staffUserIds = [work.editor?.userId, work.assignedTo?.userId].filter(Boolean) as number[];
      for (const uid of staffUserIds) {
        await tx.notification.create({
          data: {

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
      const perm = await this.workPermissionService.getEmployeeActivityTypes(targetEmpId, undefined);
      const normalizedType = normalizeActivityType(existing);
      if (!perm.isFullAccess && !perm.allowedTypes.has(normalizedType)) {
        throw new BadRequestException(
          `Cannot assign activity '${existing.title || normalizedType}' to employee #${targetEmpId}. Their role '${perm.designation}' does not support '${normalizedType}'.`,
        );
      }
    }
    if (dto.editorId) {
      const targetEditorId = Number(dto.editorId);
      const perm = await this.workPermissionService.getEmployeeActivityTypes(targetEditorId, undefined);
      if (!perm.isFullAccess && !perm.allowedTypes.has('REEL_EDIT')) {
        throw new BadRequestException(
          `Cannot assign editor role to employee #${targetEditorId}. Their role '${perm.designation}' does not support Video Editing.`,
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

    this.emitRealtimeScheduleEvent(undefined, 'PLAN_SCHEDULE_DELETED', {
      scheduleId: existing.id,
      planId: undefined,
    });

    if (this.notificationService && existing.assignedToId) {
      this.notificationService
        .sendTaskRescheduledNotification({

          employeeId: existing.assignedToId,
          workId: existing.id,
          taskName: existing.title || 'Task',
          newDate: existing.scheduledDate,
          newTime: existing.scheduledTime,
          previousDate: existing.scheduledDate ? new Date(existing.scheduledDate).toISOString().split('T')[0] : '',
          previousTime: existing.scheduledTime,
          customerName: null,
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

    // Reading a customer calendar never carries forward or creates work.
    const numCustomerId = Number(scopedCustomerId);
    if (!Number.isSafeInteger(numCustomerId) || numCustomerId < 1) {
      throw new ForbiddenException('Verified customer scope required');
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: numCustomerId, deletedAt: null, lead: { deletedAt: null } },
      include: { crmCompany: true },
    });
    if (!customer) throw new NotFoundException('Customer account not found');
    if (!customer.crmCompanyId || !customer.crmCompany || customer.crmCompany.deletedAt) {
      throw new NotFoundException('Customer is not linked to an active CRM company');
    }
    const where: any = { companyId: customer.crmCompanyId, status: { not: WorkStatus.CANCELLED } };
    const activeSubForCustomer: any = null;

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
      targetYear = query.year;
      targetMonth = query.month;
      const startOfMonth = new Date(Date.UTC(query.year, query.month - 1, 0, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(query.year, query.month, 1, 23, 59, 59, 999));
      where.scheduledDate = { gte: startOfMonth, lte: endOfMonth };
    } else if (query.dateFrom || query.dateTo || (query as any).startDate || (query as any).endDate) {
      where.scheduledDate = {};
      const from = query.dateFrom || (query as any).startDate;
      const to = query.dateTo || (query as any).endDate;
      if (from) where.scheduledDate.gte = new Date(new Date(from).getTime() - 86400000);
      if (to) {
        const toDate = new Date(to);
        toDate.setUTCHours(23, 59, 59, 999);
        toDate.setUTCDate(toDate.getUTCDate() + 1);
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

        team: {
          select: {
            id: true,

            name: true,
            leaderId: true,
            isActive: true,
            members: { select: { employeeId: true } },
          },
        },
        assignedTo: {
          select: {
            id: true,

            firstName: true,
            lastName: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: { select: { id: true, accountType: true } },
          },
        },
        editor: {
          select: {
            id: true,

            firstName: true,
            lastName: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: { select: { id: true, accountType: true } },
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
                user: { select: { id: true, accountType: true } },
              },
            },
          },
        },
        entitlement: { select: { serviceName: true } },

      },
    });
    const queryEndTime = Date.now();

    this.logger.log(
      `[WORKS_CALENDAR_DB_DEBUG]\ncustomerId: ${numCustomerId || scopedCustomerId || 'ALL'}\ndate: ${query.date || 'ALL'}\nqueryStart: ${new Date(queryStartTime).toISOString()}\nqueryEnd: ${new Date(queryEndTime).toISOString()}\ndurationMs: ${queryEndTime - queryStartTime}\nrecordCount: ${items.length}`,
    );

    // Date-only precision filtering to strictly match target day without timezone shifts
    const filteredItems = items.filter((work) => {
      const key = this.scheduleDateKey(work.scheduledDate);
      if (!key) return false;
      if (targetYear && targetMonth) {
        const [year, month, day] = key.split('-').map(Number);
        if (year !== targetYear || month !== targetMonth || (targetDay && day !== targetDay)) return false;
      }
      if (query.dateFrom && key < query.dateFrom.slice(0, 10)) return false;
      if (query.dateTo && key > query.dateTo.slice(0, 10)) return false;
      return true;
    });

    let totalPaidForSub = 0;
    let isFullyPaid = true;
    let isFirstInstallmentPaid = true;
    let unlockThresholdDate: Date | null = null;

    if (numCustomerId && activeSubForCustomer) {
      const payments = this.prisma.paymentHistory?.findMany
        ? await this.prisma.paymentHistory.findMany({
            where: {  status: 'SUCCESS' },
          })
        : [];
      totalPaidForSub = Array.isArray(payments)
        ? payments.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0)
        : 0;
      const planBasePrice = Number(activeSubForCustomer.plan?.monthlyPrice || 0);
      const planTotalWithTax = Math.round(planBasePrice * 1.18);

      isFullyPaid = totalPaidForSub >= planTotalWithTax;
      isFirstInstallmentPaid = activeSubForCustomer.status === "ACTIVE" || totalPaidForSub > 0;

      const subStartDate = new Date(activeSubForCustomer.startDate);
      unlockThresholdDate = new Date(subStartDate.getTime() + 15 * 24 * 60 * 60 * 1000);
    }

    const result = filteredItems.map((w) => {
      const purchaseRef = null;
      const startTime = w.scheduledTime || '10:00 AM';
      const endTime = '11:00 AM';
      const prodName = w.entitlement?.serviceName || w.title || w.workType;
      const planName = (activeSubForCustomer?.plan?.name ?? 'Active Plan');

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
      const workTeam = w.team ?? undefined;
      const member = actualAssignee && workTeam && (
        workTeam.members?.some((entry) => entry.employeeId === actualAssignee.id) ||
        workTeam.leaderId === actualAssignee.id
      );
      const sameTenant = workTeam?.isActive === true;
      const assignmentTeamMismatch = Boolean(actualAssignee && workTeam && !(member && sameTenant));
      const verifiedTeam = sameTenant && (!actualAssignee || member) ? workTeam : null;
      if (assignmentTeamMismatch) this.logger.warn(
        `[CALENDAR_ASSIGNMENT_TEAM_MISMATCH] workId=${w.id} customerId=${customer.id} employeeId=${actualAssignee.id} teamId=${workTeam.id}`,
      );

      return {
        id: String(w.id),
        activityId: String(w.id),

        customerId: String(customer.id),
        companyId: w.companyId,
        customerName: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.companyName,
        companyName: customer.companyName,
        businessName: customer.companyName,
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
        location: [undefined, undefined, undefined].filter(Boolean).join(', ') || null,
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
        assignedTeam: verifiedTeam?.name ?? null,
        assignedTeamId: verifiedTeam?.id ?? null,
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
DB schedules after customer filter: ${items.length}`);

    this.logger.log(`[CALENDAR_DEBUG]
DB schedules after active-plan filter: ${activeSubForCustomer ? items.filter(i => undefined === activeSubForCustomer.id).length : items.length}`);

    this.logger.log(`[CALENDAR_DEBUG]
DB schedules after date filter: ${filteredItems.length}`);

    this.logger.log(`[CALENDAR_DEBUG]
final response count: ${result.length}`);

    for (const item of result) {
      this.logger.log(`[CALENDAR_SCHEDULE_ITEM]
scheduleId: ${item.id}
customerId: CUST-${customer.id}
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
    options?: { designationMatchOnly?: boolean },
  ): number | null {
    if (!members || members.length === 0) {
      return leaderId || null;
    }

    const eligibleMembers = this.membersMatchingActivity(act, members);

    if (eligibleMembers.length > 0) {
      const chosen = eligibleMembers[roundRobinIndex % eligibleMembers.length];
      return chosen.employeeId;
    }

    if (options?.designationMatchOnly) return null;

    // Fallback: Round-robin among all team members or leader
    if (members.length > 0) {
      const chosen = members[roundRobinIndex % members.length];
      return chosen.employeeId;
    }

    return leaderId || null;
  }

  private isPlatformAdmin(person?: { user?: { accountType?: string } | null } | null): boolean {
    return ['SUPER_ADMIN', 'ADMIN'].includes(person?.user?.accountType || '');
  }

  private isSalesOrBpoEmployee(employee: any): boolean {
    return /BPO|SALES|TELECALL|TELESELL|CALL CENTER|CALL CENTRE/i.test(
      `${employee?.department?.name || ''} ${employee?.designation?.name || ''}`,
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
        user?: { accountType?: string } | null;
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
        undefined &&
        Number(undefined) !== Number(teamCustomerId)
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
    const eligible = activeMembers.map((member) => Number(member.employeeId || member.employee?.id))
      .filter((employeeId) => designationMatchIds.has(employeeId));

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
          select: { id: true, userId: true,  status: true },
        })
      : await this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, userId: true,  status: true },
        });
    if (!employee || String(employee.status || '').toUpperCase() === 'INACTIVE') return [];

    const tenantId = Number(tenantCustomerId || undefined);
    const empIds = candidateIds && candidateIds.length > 0 ? [...candidateIds] : [employeeId];

    const [memberships, ledTeams] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: {
          employeeId: { in: empIds },
          team: { isActive: true },
        },
        select: {
          teamId: true,
          team: { select: { name: true, description: true,  isActive: true } },
        },
      }),
      this.prisma.team.findMany({
        where: { leaderId: { in: empIds }, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,

          leader: { select: { status: true } },
        },
      }),
    ]);

    const rows = new Map<number, number>();
    for (const row of memberships) {
      if (row.team?.isActive === false) continue;
      if (this.isBpoOnlyTeam(row.team?.name, row.team?.description)) continue;
      rows.set(row.teamId, Number(undefined));
    }
    for (const team of ledTeams) {
      if (String(team.leader?.status || '').toUpperCase() === 'INACTIVE') continue;
      if (this.isBpoOnlyTeam(team.name, team.description)) continue;
      rows.set(team.id, Number(undefined));
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
        select: { teamId: true, team: { select: {  isActive: true } } },
      }),
      this.prisma.team.findMany({
        where: { leaderId: { in: empIds }, isActive: true },
        select: { id: true },
      }),
    ]);
    const rows = new Map<number, number>();
    for (const row of memberships || []) {
      if (row.team?.isActive === false) continue;
      rows.set(row.teamId, Number(undefined));
    }
    for (const team of ledTeams || []) {
      rows.set(team.id, Number(undefined));
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

    ];
    for (const cid of viewerIds) {
      if (cid !== employeeId) {
        orConds.push(
          { assignedToId: cid },
          { editorId: cid },
          { tasks: { some: { assignedToId: cid } } },

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
      keep(undefined);
    }
    return Array.from(ids);
  }

  private async customerIdsAssignedToTeams(teamIds: number[]): Promise<number[]> {
return []; // Customer assignment no longer exists; work/team assignments define visibility.
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
    const team = w.team || undefined || null;
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
return null; // Team must now be selected explicitly on each work item.
  }

  private async fillMissingWorkTaskAssignments(work: any, data: any, team: any, prisma: any): Promise<void> {
    for (const task of work.tasks || []) {
      if (task.assignedToId != null || task.status !== TaskStatus.PENDING) continue;
      const title = String(task.title || '').toLowerCase();
      const type = /edit|color|grad/.test(title) ? WorkType.EDITING
        : /upload|publish|social media/.test(title) ? WorkType.UPLOADING
        : /content|asset.*prep/.test(title) ? WorkType.CONTENT_WRITING
        : /shoot|camera/.test(title) ? WorkType.SHOOT : work.workType;
      const ids = await this.eligibleProductionMemberIds({ workType: type, title: task.title }, team.members, undefined);
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

                status: true,
                firstName: true,
                lastName: true,
                designation: { select: { name: true } },
                department: { select: { name: true } },
                user: { select: { id: true, accountType: true } },
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
      include: { ...(options?.onlyMissing ? { tasks: true } : {}), assignedTo: { select: { department: true, designation: true, user: { select: { id: true, accountType: true } } } } },
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
        ? await this.eligibleProductionMemberIds(work, team.members, undefined)
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
          { workType: WorkType.EDITING, title: 'Video Editing' }, team.members, undefined,
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
  async assertEmployeeAssignedToWork(employeeId: number | null | undefined, workId: number): Promise<boolean> {
    if (!employeeId) throw new ForbiddenException('Employee profile required');
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: { id: true, assignedToId: true, teamId: true },
    });
    if (!work) throw new NotFoundException(`Work record #${workId} not found`);
    if (work.assignedToId === employeeId) return true;
    if (work.teamId) {
      const isMember = await this.prisma.teamMember.findFirst({
        where: { teamId: work.teamId, employeeId },
      });
      if (isMember) return true;
    }
    throw new ForbiddenException('Work must be assigned to you or your team');
  }

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

    // Calendar access follows recorded employee/team assignments, independent of job title.
    const empRole = 'EMPLOYEE';
    const allowedTypes = new Set<string>();
    const isFullAccess = true;
    const isProductionManager = false;
    const tenantCustomerId = undefined;
    const designationName = empRecord?.designation?.name;
    const designationLabel = String(designationName || '').toUpperCase();
    const nameInferred = `${empRecord?.firstName || ''} ${empRecord?.lastName || ''}`.trim();
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

    const directCustomerIds: number[] = [];
    const allAuthorizedCustomerIds = [...new Set([...directCustomerIds, ...teamCustomerIds])];

    let where: any;
    const assignedOnly = options?.assignedOnly === true;

    const directAssignment = (): any[] => {
      const conds: any[] = [
        { assignedToId: numEmployeeId },
        { editorId: numEmployeeId },
        { tasks: { some: { assignedToId: numEmployeeId } } },



      ];
      if (directCustomerIds.length > 0) {
        conds.push();
      }
      for (const cid of viewerCandidateIds) {
        if (cid !== numEmployeeId) {
          conds.push(
            { assignedToId: cid },
            { editorId: cid },
            { tasks: { some: { assignedToId: cid } } },



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
          ...(allAuthorizedCustomerIds.length > 0 ? [] : []),
        ],
        status: { not: WorkStatus.CANCELLED },
        ...(query.teamId ? { AND: [{ OR: [
          { teamId: Number(query.teamId) },

        ] }] } : {}),
      };

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


          { team: { id: { in: authorizedTeamIds }, isActive: true } },
        );
      }
      orConditions.push(
        { team: { members: { some: { employeeId: numEmployeeId } } } },
        { team: { leaderId: numEmployeeId } },


      );
      if (allAuthorizedCustomerIds.length > 0) {
        orConditions.push();
      }
      if (tenantCustomerId) {
        orConditions.push(



        );
      }
      where = {
        OR: orConditions,
        status: { not: WorkStatus.CANCELLED },
      };



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
        ...(tenantCustomerId ? {  } : {}),
      };

      // Filter by specific customer if requested


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


          { team: { id: { in: productionTeamIds }, isActive: true } },
        );
      }
      orConditions.push(
        { team: { members: { some: { employeeId: numEmployeeId } } } },
        { team: { leaderId: numEmployeeId } },


      );
      if (allAuthorizedCustomerIds.length > 0) {
        orConditions.push();
      }

      where = {
        OR: orConditions,
        status: { not: WorkStatus.CANCELLED },
      };


    }


    // Intersect customer and active-record scope with assignment predicates; never replace them.
    where.AND = [...(where.AND || []), {
      OR: [{ companyId: null }, { company: { deletedAt: null, OR: [
        { billingCustomer: null },
        { billingCustomer: { deletedAt: null, lead: { deletedAt: null } } },
      ] } }],
    }];
    if (query.customerId !== undefined) {
      if (!Number.isSafeInteger(query.customerId) || query.customerId < 1) throw new BadRequestException('Invalid customer ID');
      const customer = await this.prisma.customer.findFirst({
        where: { id: query.customerId, deletedAt: null, lead: { deletedAt: null } },
        select: { crmCompanyId: true },
      });
      if (!customer?.crmCompanyId) throw new NotFoundException('Customer CRM company not found');
      where.companyId = customer.crmCompanyId;
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

    ];

    if (process.env.EMPLOYEE_CALENDAR_DEBUG === 'true' && typeof this.prisma.work?.count === 'function' && tenantCustomerId) {
      const tenantWork = {
        OR: [


          ...directAssignment(),
          ...teamCustomerWork(membershipTeamIds),
        ],
      };
      const activeWork = {
        AND: [tenantWork, { status: { not: WorkStatus.CANCELLED } }],
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
            AND: [activeWork, dateWindow],
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

        company: { include: { billingCustomer: { select: { id: true, firstName: true, lastName: true, companyName: true } } } },
        team: {
          select: {
            id: true,
            name: true,
            description: true,
            isActive: true,
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
            user: { select: { id: true, accountType: true } },
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
            user: { select: { id: true, accountType: true } },
          },
        },
        entitlement: { select: { serviceName: true } },

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
                user: { select: { id: true, accountType: true } },
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
    filteredItems = filteredItems.filter((work: any) => {
      const directlyAssigned = viewerIds.has(Number(work.assignedToId)) ||
        viewerIds.has(Number(work.editorId)) ||
        (work.tasks || []).some((task: any) => viewerIds.has(Number(task.assignedToId)));
      const assignedTeam = work.team?.isActive === true && (authorizedTeamIds.includes(Number(work.teamId)) ||
        viewerIds.has(Number(work.team?.leaderId)) ||
        (work.team?.members || []).some((member: any) => viewerIds.has(Number(member.employeeId))));
      return directlyAssigned || (assignedTeam && workMatchesDesignation(designationName, work.workType));
    });

    const formatScheduleDate = (dateVal: any): string => this.scheduleDateKey(dateVal) || '';

    const uniqueItems = [...new Map(filteredItems.map((w) => [String(w.id), w])).values()];
    const mapped = uniqueItems.map((w) => {
      const purchaseRef = null;
      const startTime = w.scheduledTime || '10:00 AM';
      const endTime = assignedOnly ? null : '11:00 AM';
      const prodName = w.entitlement?.serviceName || w.title || w.workType;
      const planName = null;

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

      const customerLocation = [undefined, undefined, undefined]
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

      const smHandler = undefined;
      const platform = smHandler?.platform || 'Instagram';
      const smAccount = smHandler?.accountName
        ? `${platform} — @${smHandler.accountName}`
        : ('Instagram');

      return {
        id: String(w.id),
        activityId: String(w.id),

        customerId: w.company?.billingCustomer ? String(w.company.billingCustomer.id) : '',
        companyId: w.companyId,
        companyName: w.company?.name ?? null,
        businessName: w.company?.billingCustomer?.companyName ?? w.company?.name ?? null,
        customerName: w.company?.billingCustomer
          ? [w.company.billingCustomer.firstName, w.company.billingCustomer.lastName].filter(Boolean).join(' ') || w.company.billingCustomer.companyName
          : w.company?.name ?? null,
        customerBusiness: w.company?.billingCustomer?.companyName ?? w.company?.name ?? null,
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
        teamId: w.teamId || undefined || null,
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
    if (query.customerId === undefined && typeof this.prisma.task?.findMany === 'function' && (!query.workType || query.workType === 'TASK')) {
      const taskWhere: any = {
        deletedAt: null,
      };

      if (query.status) {
        taskWhere.status = query.status;
      } else {
        taskWhere.status = { not: TaskStatus.CANCELLED };
      }

      if (!assignedOnly && tenantCustomerId && !isProductionManager) {
        const tenantId = Number(tenantCustomerId);
        const tenantScope: any[] = [];
        if (authorizedTeamIds.length > 0) {
          tenantScope.push();
        }
        tenantScope.push();
        if (allAuthorizedCustomerIds.length > 0) {
          tenantScope.push();
        }
        taskWhere.AND = [...(taskWhere.AND || []), { OR: tenantScope }];
      }

      taskWhere.AND = [
        ...(taskWhere.AND || []),

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
          taskOr.push();
        }
        if (allAuthorizedCustomerIds.length > 0) {
          taskOr.push();
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

        companyName: 'Workspace',
        businessName: 'Workspace',
        customerName: 'Customer',
        customerBusiness: 'Workspace',
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
        location: 'Head Office',
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

      if (query.customerId === undefined && typeof this.prisma.visit?.findMany === 'function') {
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

          };
        });
      }
    } catch (vErr: any) {
      this.logger.warn(`Failed to query visits for calendar: ${vErr?.message}`);
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

    const allItems = [...mapped, ...mappedTasks, ...filteredVisits];
    const result = isFullAccess || allowedTypes.size === 0
      ? allItems
      : allItems.filter((item) =>
          allowedTypes.has(item.activityType) ||
          item.activityType === 'TASK' ||
          item.activityType === 'CUSTOMER_VISIT' ||
          item.type === 'TASK' ||
          item.type === 'CUSTOMER_VISIT' ||
          item.itemType === 'TASK' ||
          item.itemType === 'VISIT' ||
          allAuthorizedCustomerIds.includes(Number(undefined)) ||
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
      Number(undefined) === numEmployeeId ||
      (w.tasks || []).some((task) => Number(task.assignedToId) === numEmployeeId),
    ).length;
    const teamWorkCount = items.filter((w) =>
      membershipTeamIds.includes(Number(w.teamId || w.team?.id)),
    ).length;
    const customerWorkCount = items.filter((w) =>
      membershipTeamIds.includes(Number(undefined)) ||
      teamCustomerIds.includes(Number(undefined)),
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

    const uniqueCustIds = [...new Set(uniqueResult.map((r) => undefined).filter(Boolean))];

    const customerTaskMap = new Map<string, { name: string; count: number }>();
    for (const r of uniqueResult) {
      const cId = String('0');
      const cName = r.customerName || r.companyName || 'Unknown';
      const existing = customerTaskMap.get(cId) || { name: cName, count: 0 };
      existing.count++;
      customerTaskMap.set(cId, existing);
    }
    const customerLines = Array.from(customerTaskMap.entries())
      .map(([cId, data]) => `Customer ID ${cId} - ${data.name} - ${data.count} tasks`)
      .join('\n');

    this.logger.log(`[EMPLOYEE_CALENDAR_DEBUG]

Employee:
${empRecord?.employeeCode || `QB-EMP-${numEmployeeId}`}

Teams:
${authorizedTeamIds.length > 0 ? authorizedTeamIds.join(', ') : 'NONE'}

Total assigned works: ${filteredItems.length}

Customers:
${customerLines || 'No customer tasks'}

Final returned records: ${uniqueResult.length}`);

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

    this.logger.log(`[EMPLOYEE_CALENDAR_API_DEBUG]

employeeId: ${numEmployeeId}
teamIds: ${JSON.stringify(authorizedTeamIds)}
totalApiRecords: ${uniqueResult.length}`);

    for (const item of uniqueResult) {
      this.logger.log(`workId: ${item.id}
activityId: ${item.activityId || item.id}
customerId: ${undefined}
customerName: ${item.customerName || item.companyName}
scheduledDate: ${item.scheduledDate}
startTime: ${item.scheduledTime || item.startTime || item.time}
teamId: ${item.teamId}
employeeId: ${item.assignedToId || numEmployeeId}
status: ${item.status}`);
    }

    this.logger.log(`uniqueCustomerIds: ${JSON.stringify(uniqueCustIds)}
uniqueCustomerCount: ${uniqueCustIds.length}`);

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

    }

    const numEmployeeId = Number(employeeId);
    const emp = await this.prisma.employee.findUnique({
      where: { id: numEmployeeId },
      select: {  status: true },
    });



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
      const codeCustomerId = Number(undefined);
      const byCode = await this.prisma.employee.findFirst({
        where: {
          ...(Number.isInteger(codeCustomerId) && codeCustomerId > 0 ? {  } : {}),
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

    }
    const byCode = await this.prisma.employee.findFirst({
      where: codeWhere,
      select: { id: true },
    });
    if (byCode?.id) return byCode.id;

    return null;
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


    const existing = await this.findOne(numCustomerId, numId);


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

    const oldDateStr = existing.scheduledDate ? new Date(existing.scheduledDate).toISOString().split('T')[0] : 'N/A';
    const newDateStr = newDate.toISOString().split('T')[0];

    this.logger.log(
      `[RESCHEDULE_REQUEST] customerId: ${numCustomerId} activityId: ${numId} title: "${existing.title}" oldDate: ${oldDateStr} newDate: ${newDateStr}`,
    );

    // Validate Sunday / working day rule
    if (newDate.getDay() === 0) {
      const customerPolicy = await this.prisma.attendancePolicy.findFirst({
        where: {  isActive: true },
      });
      if (customerPolicy && customerPolicy.workingDaysPerWeek <= 5) {
        throw new BadRequestException('Rescheduling is not allowed on Sundays according to working calendar policy.');
      }
    }

    const titleLower = (existing.title || '').toLowerCase();
    const subId = undefined;

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
      const customerName = null;
      this.notificationService
        .sendTaskRescheduledNotification({

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


    const existing = await this.findOne(numCustomerId, numId);


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
      planId: undefined,
      date: reworkItem.scheduledDate ? new Date(reworkItem.scheduledDate).toISOString().split('T')[0] : undefined,
    });

    return {
      success: true,
      message: 'Rework request submitted successfully.',
      rework: reworkItem,
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

        assignedTo: true,
      },
    });

    this.emitRealtimeScheduleEvent(undefined, 'SCHEDULE_STATUS_CHANGED', {
      scheduleId: updated.id,
      status: 'completed',
    });

    if (!wasAlreadyCompleted) {
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

    this.emitRealtimeScheduleEvent(undefined, 'SCHEDULE_STATUS_CHANGED', {
      scheduleId: updated.id,
      status: 'cancelled',
    });

    return {
      success: true,
      activity: updated,
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
