import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { S3Service } from '../s3/s3.service';
import { isUserAdmin } from '../../common/utils/role.util';
import {
  formatTimeInTimezone,
  getBusinessDate,
  getBusinessDayRange,
} from '../../common/utils/timezone.util';
import { computeShiftHalfDayBreakdown } from '../leave/half-day-leave.util';
import {
  AssignTelecallerTargetDto,
  RecordCallEventDto,
  UpdateTelecallerTargetDto,
  UpsertRewardSlabsDto,
  UpsertTelecallerTargetPolicyDto,
} from './dto/telecaller-targets.dto';
import {
  TELECALLER_METRIC_CATALOG,
  calculateTelecallerPerformance,
  round2,
} from './telecaller-targets.calculator';
import { renderDailyPerformancePdf } from './telecaller-performance-pdf';
import { applyExcelBranding } from '../../common/utils/report-branding.util';

const CALL_VERIFICATION_LIMITATION =
  'External telephony/dialer webhook is not configured; connected calls and durations rely on verified CRM call-log statuses rather than carrier CDR webhooks.';

@Injectable()
export class TelecallerTargetsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelecallerTargetsService.name);
  private retryTimer: NodeJS.Timeout | null = null;
  private retryBusy = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly whatsappService?: WhatsappService,
    @Optional() private readonly s3Service?: S3Service,
  ) {}

  onModuleInit() {
    this.retryTimer = setInterval(() => {
      this.processPendingReportRetries().catch((err) =>
        this.logger.warn(`Telecaller report retry tick failed: ${err?.message}`),
      );
    }, 5 * 60_000);
  }

  onModuleDestroy() {
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  private async resolveCustomerId(user: any, customerId?: number | string): Promise<number> {
    const parsed = Number(customerId ?? user?.customerId);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    const customer = await this.prisma.customer.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return customer?.id || 1;
  }

  private async resolveEmployeeForUser(user: any, customerId: number) {
    if (user?.employeeId) {
      const byId = await this.prisma.employee.findFirst({
        where: { id: Number(user.employeeId), customerId },
        include: { shift: true, department: true, designation: true },
      });
      if (byId) return byId;
    }
    if (user?.id) {
      const byUser = await this.prisma.employee.findFirst({
        where: { userId: Number(user.id), customerId },
        include: { shift: true, department: true, designation: true },
      });
      if (byUser) return byUser;
    }
    return null;
  }

  private metricLabelFor(key: string, customLabel?: string): string {
    if (customLabel?.trim()) return customLabel.trim();
    const found = TELECALLER_METRIC_CATALOG.find((m) => m.key === key);
    return found ? found.label : key.replace(/_/g, ' ');
  }

  getMetricCatalog() {
    return TELECALLER_METRIC_CATALOG;
  }

  async getPolicy(user: any, customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const existing = await this.prisma.telecallerTargetPolicy.findUnique({
      where: { customerId: numCustomerId },
    });
    return (
      existing || {
        customerId: numCustomerId,
        adjustForHalfDayLeave: true,
        excludeFullDayLeave: true,
        excludeHolidays: true,
        excludeWeeklyOff: true,
        autoSendOnFinalPunchOut: true,
        emailTemplateKey: null,
        emailSubjectTemplate: 'Daily Performance Report - {{employeeName}} ({{reportDate}})',
        whatsappTemplateName: null,
        whatsappLanguageCode: 'en_US',
        whatsappVariableMapping: {
          '1': 'employeeName',
          '2': 'reportDate',
          '3': 'overallScore',
        },
        maxRetryAttempts: 3,
        minConnectedCalls: 60,
        maxConnectedCalls: 70,
      }
    );
  }

  async upsertPolicy(user: any, customerId: number | string | undefined, dto: UpsertTelecallerTargetPolicyDto) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    return this.prisma.telecallerTargetPolicy.upsert({
      where: { customerId: numCustomerId },
      create: {
        customerId: numCustomerId,
        adjustForHalfDayLeave: dto.adjustForHalfDayLeave ?? true,
        excludeFullDayLeave: dto.excludeFullDayLeave ?? true,
        excludeHolidays: dto.excludeHolidays ?? true,
        excludeWeeklyOff: dto.excludeWeeklyOff ?? true,
        autoSendOnFinalPunchOut: dto.autoSendOnFinalPunchOut ?? true,
        emailTemplateKey: dto.emailTemplateKey ?? null,
        emailSubjectTemplate: dto.emailSubjectTemplate ?? null,
        whatsappTemplateName: dto.whatsappTemplateName ?? null,
        whatsappLanguageCode: dto.whatsappLanguageCode ?? 'en_US',
        whatsappVariableMapping: dto.whatsappVariableMapping ?? undefined,
        maxRetryAttempts: dto.maxRetryAttempts ?? 3,
        minConnectedCalls: dto.minConnectedCalls ?? 60,
        maxConnectedCalls: dto.maxConnectedCalls ?? 70,
      },
      update: {
        ...(dto.adjustForHalfDayLeave !== undefined ? { adjustForHalfDayLeave: dto.adjustForHalfDayLeave } : {}),
        ...(dto.excludeFullDayLeave !== undefined ? { excludeFullDayLeave: dto.excludeFullDayLeave } : {}),
        ...(dto.excludeHolidays !== undefined ? { excludeHolidays: dto.excludeHolidays } : {}),
        ...(dto.excludeWeeklyOff !== undefined ? { excludeWeeklyOff: dto.excludeWeeklyOff } : {}),
        ...(dto.autoSendOnFinalPunchOut !== undefined ? { autoSendOnFinalPunchOut: dto.autoSendOnFinalPunchOut } : {}),
        ...(dto.emailTemplateKey !== undefined ? { emailTemplateKey: dto.emailTemplateKey } : {}),
        ...(dto.emailSubjectTemplate !== undefined ? { emailSubjectTemplate: dto.emailSubjectTemplate } : {}),
        ...(dto.whatsappTemplateName !== undefined ? { whatsappTemplateName: dto.whatsappTemplateName } : {}),
        ...(dto.whatsappLanguageCode !== undefined ? { whatsappLanguageCode: dto.whatsappLanguageCode } : {}),
        ...(dto.whatsappVariableMapping !== undefined ? { whatsappVariableMapping: dto.whatsappVariableMapping } : {}),
        ...(dto.maxRetryAttempts !== undefined ? { maxRetryAttempts: dto.maxRetryAttempts } : {}),
        ...(dto.minConnectedCalls !== undefined ? { minConnectedCalls: dto.minConnectedCalls } : {}),
        ...(dto.maxConnectedCalls !== undefined ? { maxConnectedCalls: dto.maxConnectedCalls } : {}),
      },
    });
  }

  private defaultRewardSlabs() {
    return [
      { id: 0, label: '120 Calls (Target)', minCalls: 120, maxCalls: 120, rewardPoints: 100, sortOrder: 1 },
      { id: 0, label: '121 – 150 Calls', minCalls: 121, maxCalls: 150, rewardPoints: 150, sortOrder: 2 },
      { id: 0, label: '151 – 200 Calls', minCalls: 151, maxCalls: 200, rewardPoints: 250, sortOrder: 3 },
      { id: 0, label: '200+ Calls', minCalls: 201, maxCalls: null, rewardPoints: 400, sortOrder: 4 },
    ];
  }

  async getRewardSlabs(user: any, customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const rows = await this.prisma.telecallerRewardSlab.findMany({
      where: { customerId: numCustomerId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { minCalls: 'asc' }],
    });
    return {
      success: true,
      data: rows.length > 0 ? rows : this.defaultRewardSlabs(),
    };
  }

  async upsertRewardSlabs(user: any, customerId: number | string | undefined, dto: UpsertRewardSlabsDto) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const slabs = Array.isArray(dto.slabs) ? dto.slabs : [];
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.telecallerRewardSlab.updateMany({
        where: { customerId: numCustomerId, isActive: true },
        data: { isActive: false },
      });
      const created = [];
      for (let i = 0; i < slabs.length; i++) {
        const s = slabs[i];
        const row = await tx.telecallerRewardSlab.create({
          data: {
            customerId: numCustomerId,
            label: String(s.label || `${s.minCalls}+ Calls`).trim(),
            minCalls: Math.max(1, Number(s.minCalls) || 1),
            maxCalls: s.maxCalls != null && s.maxCalls !== ('' as any) ? Number(s.maxCalls) : null,
            rewardPoints: Math.max(0, Number(s.rewardPoints) || 0),
            sortOrder: s.sortOrder ?? i + 1,
            isActive: s.isActive !== false,
          },
        });
        created.push(row);
      }
      return created;
    });
    return { success: true, data: saved };
  }

  private async evaluateAndCreditCallRewards(
    customerId: number,
    employeeId: number,
    businessDate: string,
    totalCalls: number,
    connectedCalls: number,
    callTarget: number,
  ) {
    const { data: slabs } = await this.getRewardSlabs({ customerId }, customerId);
    const sorted = [...slabs].sort((a, b) => a.minCalls - b.minCalls);
    let matched: any = null;
    for (const slab of sorted) {
      if (totalCalls >= slab.minCalls) {
        matched = slab;
      }
    }
    if (!matched && callTarget > 0 && totalCalls >= callTarget && sorted.length > 0) {
      matched = sorted[0];
    }
    if (!matched) return null;

    const isExtraBonus = matched.minCalls > (sorted[0]?.minCalls ?? callTarget);
    const title = isExtraBonus ? 'Extra Calls Bonus' : 'Daily Call Target Completed';
    const idempotencyKey = `call_reward:${customerId}:${employeeId}:${businessDate}`;

    return this.prisma.telecallerRewardLedger.upsert({
      where: { idempotencyKey },
      create: {
        customerId,
        employeeId,
        businessDate,
        title,
        totalCalls,
        connectedCalls,
        points: matched.rewardPoints,
        status: 'CREDITED',
        slabId: matched.id > 0 ? matched.id : null,
        idempotencyKey,
      },
      update: {
        title,
        totalCalls,
        connectedCalls,
        points: matched.rewardPoints,
        slabId: matched.id > 0 ? matched.id : null,
      },
    });
  }

  async getMyDailyRewards(user: any, customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const employee = await this.resolveEmployeeForUser(user, numCustomerId);
    const policy = await this.getPolicy({ customerId: numCustomerId }, numCustomerId);
    const { data: slabs } = await this.getRewardSlabs({ customerId: numCustomerId }, numCustomerId);

    if (!employee) {
      return {
        success: true,
        data: {
          businessDate: getBusinessDate(new Date()),
          targetCalls: 0,
          totalCalls: 0,
          connectedCalls: 0,
          minConnectedCalls: policy.minConnectedCalls ?? 60,
          maxConnectedCalls: policy.maxConnectedCalls ?? 70,
          todayInquiries: 0,
          todayVisits: 0,
          targetCompleted: false,
          earnedPoints: 0,
          slabs: slabs.map((s) => ({ ...s, isCurrent: false })),
          history: [],
          callVerificationLimitation: CALL_VERIFICATION_LIMITATION,
        },
      };
    }

    const businessDate = this.resolveShiftBusinessDate(new Date(), employee.shift);
    const { perf, stats } = await this.computeAndSaveDailySnapshot(
      numCustomerId,
      employee.id,
      businessDate,
    );

    const callMetric = perf.metrics.find((m) => m.metricKey === 'OUTGOING_CALLS' && !m.excluded);
    const targetCalls = callMetric ? Number(callMetric.effectiveTarget || 0) : 0;
    const totalCalls = stats.outgoingCalls;
    const connectedCalls = stats.connectedCalls;
    const todayInquiries = stats.newLeadsCreated;
    const todayVisits = stats.visitsScheduled + stats.visitsCompleted;
    const targetCompleted = targetCalls > 0 && totalCalls >= targetCalls;

    await this.evaluateAndCreditCallRewards(
      numCustomerId,
      employee.id,
      businessDate,
      totalCalls,
      connectedCalls,
      targetCalls,
    );

    const todayLedger = await this.prisma.telecallerRewardLedger.findFirst({
      where: { customerId: numCustomerId, employeeId: employee.id, businessDate },
    });

    const history = await this.prisma.telecallerRewardLedger.findMany({
      where: { customerId: numCustomerId, employeeId: employee.id },
      orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
      take: 30,
    });

    const sortedSlabs = [...slabs].sort((a, b) => a.minCalls - b.minCalls);
    let currentSlabIdx = -1;
    for (let i = 0; i < sortedSlabs.length; i++) {
      if (totalCalls >= sortedSlabs[i].minCalls) currentSlabIdx = i;
    }

    return {
      success: true,
      data: {
        businessDate,
        targetCalls,
        totalCalls,
        connectedCalls,
        minConnectedCalls: policy.minConnectedCalls ?? 60,
        maxConnectedCalls: policy.maxConnectedCalls ?? 70,
        todayInquiries,
        todayVisits,
        targetCompleted,
        earnedPoints: todayLedger?.points ?? 0,
        slabs: sortedSlabs.map((s, idx) => ({
          ...s,
          isCurrent: idx === currentSlabIdx,
        })),
        history,
        callVerificationLimitation: CALL_VERIFICATION_LIMITATION,
      },
    };
  }

  async getRewardHistory(
    user: any,
    customerId?: number | string,
    query?: { employeeId?: number; fromDate?: string; toDate?: string },
  ) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const admin = isUserAdmin(user);
    const selfEmp = await this.resolveEmployeeForUser(user, numCustomerId);
    const employeeId = admin && query?.employeeId ? Number(query.employeeId) : (!admin ? selfEmp?.id : undefined);

    const rows = await this.prisma.telecallerRewardLedger.findMany({
      where: {
        customerId: numCustomerId,
        ...(employeeId ? { employeeId } : {}),
        ...(query?.fromDate || query?.toDate
          ? {
              businessDate: {
                ...(query.fromDate ? { gte: query.fromDate } : {}),
                ...(query.toDate ? { lte: query.toDate } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return { success: true, data: rows };
  }

  async assignTargets(user: any, customerId: number | string | undefined, dto: AssignTelecallerTargetDto) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const metricKey = dto.metricKey.trim().toUpperCase();
    const metricLabel = this.metricLabelFor(metricKey, dto.metricLabel);
    const periodType = (dto.periodType || 'DAILY').toUpperCase();
    const effectiveDate = new Date(dto.effectiveDate);
    const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;

    if (isNaN(effectiveDate.getTime())) {
      throw new BadRequestException('Invalid effectiveDate');
    }
    if (expiryDate && expiryDate < effectiveDate) {
      throw new BadRequestException('expiryDate cannot be before effectiveDate');
    }

    const targetsToCreate: Array<{ employeeId: number | null; departmentId: number | null }> = [];
    if (Array.isArray(dto.employeeIds) && dto.employeeIds.length > 0) {
      for (const empId of dto.employeeIds) {
        targetsToCreate.push({ employeeId: Number(empId), departmentId: null });
      }
    } else if (dto.employeeId) {
      targetsToCreate.push({ employeeId: Number(dto.employeeId), departmentId: null });
    } else if (dto.departmentId) {
      targetsToCreate.push({ employeeId: null, departmentId: Number(dto.departmentId) });
    } else {
      throw new BadRequestException('Provide employeeId, employeeIds, or departmentId');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const rows = [];
      for (const scope of targetsToCreate) {
        const assignment = await tx.telecallerTargetAssignment.create({
          data: {
            customerId: numCustomerId,
            employeeId: scope.employeeId,
            departmentId: scope.departmentId,
            metricKey,
            metricLabel,
            periodType,
            targetValue: Number(dto.targetValue),
            weightage: dto.weightage != null ? Number(dto.weightage) : null,
            effectiveDate,
            expiryDate,
            recurrence: (dto.recurrence || 'RECURRING').toUpperCase(),
            isOverride: Boolean(dto.isOverride),
            isActive: true,
            assignedById: user?.id ? Number(user.id) : null,
            notes: dto.notes?.trim() || null,
          },
        });
        await tx.telecallerTargetHistory.create({
          data: {
            assignmentId: assignment.id,
            customerId: numCustomerId,
            changedById: user?.id ? Number(user.id) : null,
            action: dto.isOverride ? 'OVERRIDE_SET' : 'CREATED',
            previousData: undefined,
            newData: assignment as any,
            reason: dto.notes?.trim() || 'Target assigned',
          },
        });
        rows.push(assignment);
      }
      return rows;
    });

    return { success: true, count: created.length, data: created };
  }

  async listTargets(
    user: any,
    customerId: number | string | undefined,
    query: { employeeId?: number; departmentId?: number; periodType?: string; activeOnly?: boolean },
  ) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const items = await this.prisma.telecallerTargetAssignment.findMany({
      where: {
        customerId: numCustomerId,
        ...(query.employeeId ? { employeeId: Number(query.employeeId) } : {}),
        ...(query.departmentId ? { departmentId: Number(query.departmentId) } : {}),
        ...(query.periodType ? { periodType: query.periodType.toUpperCase() } : {}),
        ...(query.activeOnly !== false ? { isActive: true } : {}),
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, departmentId: true } },
      },
      orderBy: [{ isOverride: 'desc' }, { effectiveDate: 'desc' }, { id: 'desc' }],
    });
    return { success: true, data: items };
  }

  async updateTarget(
    user: any,
    customerId: number | string | undefined,
    id: number,
    dto: UpdateTelecallerTargetDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const existing = await this.prisma.telecallerTargetAssignment.findFirst({
      where: { id, customerId: numCustomerId },
    });
    if (!existing) throw new NotFoundException(`Target assignment #${id} not found`);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.telecallerTargetAssignment.update({
        where: { id },
        data: {
          ...(dto.targetValue !== undefined ? { targetValue: Number(dto.targetValue) } : {}),
          ...(dto.weightage !== undefined ? { weightage: dto.weightage != null ? Number(dto.weightage) : null } : {}),
          ...(dto.effectiveDate !== undefined ? { effectiveDate: new Date(dto.effectiveDate) } : {}),
          ...(dto.expiryDate !== undefined ? { expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null } : {}),
          ...(dto.recurrence !== undefined ? { recurrence: dto.recurrence.toUpperCase() } : {}),
          ...(dto.isOverride !== undefined ? { isOverride: dto.isOverride } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
      await tx.telecallerTargetHistory.create({
        data: {
          assignmentId: id,
          customerId: numCustomerId,
          changedById: user?.id ? Number(user.id) : null,
          action: dto.isActive === false ? 'DEACTIVATED' : 'UPDATED',
          previousData: existing as any,
          newData: row as any,
          reason: dto.reason?.trim() || 'Target updated',
        },
      });
      return row;
    });

    return { success: true, data: updated };
  }

  async getTargetHistory(user: any, customerId: number | string | undefined, assignmentId?: number) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const rows = await this.prisma.telecallerTargetHistory.findMany({
      where: {
        customerId: numCustomerId,
        ...(assignmentId ? { assignmentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { success: true, data: rows };
  }

  /**
   * Idempotent activity ingestion used by CRM Lead, Visit, Proposal, and Call endpoints.
   */
  async recordActivityEvent(params: {
    customerId: number;
    employeeId?: number | null;
    metricKey: string;
    eventType: string;
    entityType: string;
    entityId: string | number;
    idempotencyKey: string;
    occurredAt?: Date;
    callStatus?: string | null;
    durationSeconds?: number | null;
    isVerified?: boolean;
    metadata?: Record<string, any>;
  }) {
    if (!params.employeeId) return null;
    const occurredAt = params.occurredAt || new Date();
    const emp = await this.prisma.employee.findFirst({
      where: { id: Number(params.employeeId), customerId: Number(params.customerId) },
      include: { shift: true },
    });
    if (!emp) return null;

    const businessDate = this.resolveShiftBusinessDate(occurredAt, emp.shift);

    try {
      const event = await this.prisma.telecallerActivityEvent.create({
        data: {
          customerId: Number(params.customerId),
          employeeId: Number(params.employeeId),
          metricKey: params.metricKey,
          eventType: params.eventType,
          entityType: params.entityType,
          entityId: String(params.entityId),
          idempotencyKey: params.idempotencyKey,
          occurredAt,
          businessDate,
          callStatus: params.callStatus ?? null,
          durationSeconds: params.durationSeconds ?? null,
          isVerified: params.isVerified ?? true,
          metadata: params.metadata ?? undefined,
        },
      });

      this.computeAndSaveDailySnapshot(Number(params.customerId), emp.id, businessDate).catch((err) =>
        this.logger.warn(`Snapshot refresh failed for emp=${emp.id}: ${err?.message}`),
      );
      return event;
    } catch (error: any) {
      // Unique constraint on idempotencyKey -> safely ignore duplicate retry/webhook
      if (error?.code === 'P2002') {
        return null;
      }
      this.logger.warn(`recordActivityEvent skipped (${params.idempotencyKey}): ${error?.message}`);
      return null;
    }
  }

  async recordCallEvent(user: any, customerId: number | string | undefined, dto: RecordCallEventDto) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const employee = await this.resolveEmployeeForUser(user, numCustomerId);
    if (!employee) {
      throw new ForbiddenException('Only authenticated employees can log call activity.');
    }

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const isWebhook = Boolean(dto.isVerifiedWebhook);
    const outEvent = await this.recordActivityEvent({
      customerId: numCustomerId,
      employeeId: employee.id,
      metricKey: 'OUTGOING_CALLS',
      eventType: 'CALL_RECORDED',
      entityType: dto.leadId ? 'Lead' : 'Call',
      entityId: dto.leadId || dto.idempotencyKey,
      idempotencyKey: `call_out:${numCustomerId}:${employee.id}:${dto.idempotencyKey}`,
      occurredAt,
      callStatus: dto.callStatus,
      durationSeconds: dto.durationSeconds ?? null,
      isVerified: true,
      metadata: { ...(dto.metadata || {}), source: isWebhook ? 'VERIFIED_WEBHOOK' : 'CRM_CALL_LOG' },
    });

    let connectedEvent: any = null;
    if (dto.callStatus === 'CONNECTED') {
      connectedEvent = await this.recordActivityEvent({
        customerId: numCustomerId,
        employeeId: employee.id,
        metricKey: 'CONNECTED_CALLS',
        eventType: 'CALL_CONNECTED',
        entityType: dto.leadId ? 'Lead' : 'Call',
        entityId: dto.leadId || dto.idempotencyKey,
        idempotencyKey: `call_conn:${numCustomerId}:${employee.id}:${dto.idempotencyKey}`,
        occurredAt,
        callStatus: dto.callStatus,
        durationSeconds: dto.durationSeconds ?? null,
        isVerified: isWebhook || dto.callStatus === 'CONNECTED',
        metadata: { ...(dto.metadata || {}), source: isWebhook ? 'VERIFIED_WEBHOOK' : 'CRM_CALL_LOG' },
      });
    }

    return {
      success: true,
      outgoingRecorded: Boolean(outEvent),
      connectedRecorded: Boolean(connectedEvent),
      callVerificationLimitation: isWebhook ? null : CALL_VERIFICATION_LIMITATION,
    };
  }

  /**
   * Resolves the working business date for an activity timestamp, handling overnight shifts.
   */
  resolveShiftBusinessDate(occurredAt: Date, shift?: { startTime?: string | null; endTime?: string | null; isNightShift?: boolean | null } | null): string {
    const baseDate = getBusinessDate(occurredAt);
    if (!shift?.startTime || !shift?.endTime) return baseDate;

    const toMins = (s: string) => {
      const m = s.trim().toUpperCase().match(/(\d+):(\d+)\s*(AM|PM)?/);
      if (!m) return null;
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      if (m[3] === 'PM' && h < 12) h += 12;
      if (m[3] === 'AM' && h === 12) h = 0;
      return h * 60 + min;
    };

    const startM = toMins(shift.startTime);
    const endM = toMins(shift.endTime);
    if (startM == null || endM == null) return baseDate;
    const isOvernight = Boolean(shift.isNightShift) || endM <= startM;
    if (!isOvernight) return baseDate;

    const istTime = formatTimeInTimezone(occurredAt);
    const parts = istTime.match(/(\d+):(\d+)/);
    if (!parts) return baseDate;
    const nowM = parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
    if (nowM <= endM && nowM < startM) {
      const prev = new Date(occurredAt.getTime() - 86_400_000);
      return getBusinessDate(prev);
    }
    return baseDate;
  }

  private async resolveActiveAssignmentsForDate(
    customerId: number,
    employee: { id: number; departmentId?: number | null },
    businessDate: string,
    periodType = 'DAILY',
  ) {
    const { start, end } = getBusinessDayRange(businessDate);
    const all = await this.prisma.telecallerTargetAssignment.findMany({
      where: {
        customerId,
        periodType,
        isActive: true,
        effectiveDate: { lte: end },
        OR: [{ expiryDate: null }, { expiryDate: { gte: start } }],
        AND: [
          {
            OR: [
              { employeeId: employee.id },
              ...(employee.departmentId ? [{ departmentId: employee.departmentId, employeeId: null }] : []),
            ],
          },
        ],
      },
      orderBy: [{ isOverride: 'desc' }, { employeeId: 'desc' }, { effectiveDate: 'desc' }, { id: 'desc' }],
    });

    // Employee-specific / override assignments take precedence over department defaults per metricKey
    const byMetric = new Map<string, typeof all[number]>();
    for (const row of all) {
      const existing = byMetric.get(row.metricKey);
      if (!existing) {
        byMetric.set(row.metricKey, row);
        continue;
      }
      const rowIsEmp = row.employeeId === employee.id;
      const existingIsEmp = existing.employeeId === employee.id;
      if ((row.isOverride && !existing.isOverride) || (rowIsEmp && !existingIsEmp)) {
        byMetric.set(row.metricKey, row);
      }
    }
    return Array.from(byMetric.values());
  }

  private async getActualCountsForRange(customerId: number, employeeId: number, fromDate: string, toDate: string) {
    const rows = await this.prisma.telecallerActivityEvent.groupBy({
      by: ['metricKey'],
      where: {
        customerId,
        employeeId,
        businessDate: { gte: fromDate, lte: toDate },
      },
      _count: { _all: true },
    });

    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r.metricKey] = r._count._all;
    }

    const webhookEvents = await this.prisma.telecallerActivityEvent.count({
      where: {
        customerId,
        employeeId,
        businessDate: { gte: fromDate, lte: toDate },
        metricKey: 'CONNECTED_CALLS',
      },
    });
    return { counts: map, hasConnectedCalls: webhookEvents > 0 };
  }

  async computeAndSaveDailySnapshot(customerId: number, employeeId: number, businessDate: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId },
      include: { shift: true, department: true, designation: true },
    });
    if (!employee) throw new NotFoundException(`Employee #${employeeId} not found`);

    const policy = await this.getPolicy({ customerId }, customerId);
    const { start, end } = getBusinessDayRange(businessDate);

    const [attendance, leaves, holiday, attPolicy, assignments, actuals] = await Promise.all([
      this.prisma.attendance.findFirst({
        where: { employeeId, date: { gte: start, lte: end } },
        orderBy: { id: 'desc' },
      }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId, status: 'APPROVED', fromDate: { lte: end }, toDate: { gte: start } },
        select: { id: true, durationType: true, halfDaySession: true, days: true },
      }),
      (this.prisma as any).publicHoliday?.findFirst
        ? (this.prisma as any).publicHoliday.findFirst({
            where: { customerId, isActive: true, date: { gte: start, lte: end } },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.prisma.attendancePolicy.findFirst({
        where: { customerId, isActive: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.resolveActiveAssignmentsForDate(customerId, employee, businessDate, 'DAILY'),
      this.getActualCountsForRange(customerId, employeeId, businessDate, businessDate),
    ]);

    const isFullDayLeave =
      leaves.some((l) => l.durationType !== 'HALF_DAY' && Number(l.days) !== 0.5) ||
      (leaves.some((l) => l.halfDaySession === 'FIRST_HALF') &&
        leaves.some((l) => l.halfDaySession === 'SECOND_HALF'));
    const isHalfDayLeave = !isFullDayLeave && (
      Boolean(attendance?.isHalfDayLeave) ||
      leaves.some((l) => l.durationType === 'HALF_DAY' || Number(l.days) === 0.5)
    );

    const breakdown = computeShiftHalfDayBreakdown(businessDate, employee.shift, attPolicy);
    const halfDayRatio =
      breakdown.totalWorkingHours > 0
        ? breakdown.halfWorkingHours / breakdown.totalWorkingHours
        : 0.5;

    const weekdayName = new Date(`${businessDate}T00:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    });
    const shiftWorkingDays: string[] = Array.isArray(employee.shift?.workingDays)
      ? (employee.shift!.workingDays as string[])
      : [];
    const isWeeklyOff =
      shiftWorkingDays.length > 0 &&
      !shiftWorkingDays.some((d) => d.toLowerCase() === weekdayName.toLowerCase());

    const perf = calculateTelecallerPerformance({
      targets: assignments.map((a) => ({
        assignmentId: a.id,
        metricKey: a.metricKey,
        metricLabel: a.metricLabel,
        periodType: a.periodType,
        baseTarget: a.targetValue,
        actual: actuals.counts[a.metricKey] ?? 0,
        weightage: a.weightage,
      })),
      isFullDayLeave,
      isHalfDayLeave,
      halfDayRatio,
      isHoliday: Boolean(holiday),
      isWeeklyOff,
      policy,
      totalsByMetric: actuals.counts,
    });

    const stats = {
      outgoingCalls: actuals.counts['OUTGOING_CALLS'] ?? 0,
      connectedCalls: actuals.counts['CONNECTED_CALLS'] ?? 0,
      followUpsCompleted: actuals.counts['FOLLOW_UPS_COMPLETED'] ?? 0,
      newLeadsCreated: actuals.counts['NEW_LEADS_CREATED'] ?? 0,
      visitsScheduled: actuals.counts['VISITS_SCHEDULED'] ?? 0,
      visitsCompleted: actuals.counts['VISITS_COMPLETED'] ?? 0,
      proposalsSent: actuals.counts['PROPOSALS_SENT'] ?? 0,
      leadsWon: actuals.counts['LEADS_WON'] ?? 0,
    };

    const snapshot = await this.prisma.dailyPerformanceSnapshot.upsert({
      where: {
        customerId_employeeId_businessDate: { customerId, employeeId, businessDate },
      },
      create: {
        customerId,
        employeeId,
        businessDate,
        shiftId: employee.shiftId ?? null,
        shiftName: employee.shift?.name ?? null,
        attendanceStatus: attendance?.status ?? (isFullDayLeave ? 'LEAVE' : isHalfDayLeave ? 'HALF_DAY' : null),
        punchIn: attendance?.punchIn ?? null,
        punchOut: attendance?.punchOut ?? null,
        workingHours: Number(attendance?.workingHours ?? 0),
        isHalfDayLeave,
        isFullDayLeave,
        isHoliday: Boolean(holiday),
        isWeeklyOff,
        overallScore: perf.overallScore,
        callConnectionRate: perf.callConnectionRate,
        leadConversionRate: perf.leadConversionRate,
        metricBreakdown: perf.metrics as any,
        totals: stats as any,
      },
      update: {
        shiftId: employee.shiftId ?? null,
        shiftName: employee.shift?.name ?? null,
        attendanceStatus: attendance?.status ?? (isFullDayLeave ? 'LEAVE' : isHalfDayLeave ? 'HALF_DAY' : null),
        punchIn: attendance?.punchIn ?? null,
        punchOut: attendance?.punchOut ?? null,
        workingHours: Number(attendance?.workingHours ?? 0),
        isHalfDayLeave,
        isFullDayLeave,
        isHoliday: Boolean(holiday),
        isWeeklyOff,
        overallScore: perf.overallScore,
        callConnectionRate: perf.callConnectionRate,
        leadConversionRate: perf.leadConversionRate,
        metricBreakdown: perf.metrics as any,
        totals: stats as any,
        snapshotVersion: { increment: 1 },
      },
    });

    return { employee, attendance, perf, stats, snapshot, breakdown };
  }

  async getMyTodayTargets(user: any, customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const employee = await this.resolveEmployeeForUser(user, numCustomerId);
    if (!employee) {
      return {
        success: true,
        data: {
          hasTargets: false,
          targets: [],
          overallScore: 0,
          callVerificationLimitation: CALL_VERIFICATION_LIMITATION,
        },
      };
    }

    const businessDate = this.resolveShiftBusinessDate(new Date(), employee.shift);
    const { perf, stats, attendance } = await this.computeAndSaveDailySnapshot(
      numCustomerId,
      employee.id,
      businessDate,
    );

    const activeTargets = perf.metrics.filter((m) => !m.excluded);
    return {
      success: true,
      data: {
        businessDate,
        shiftName: employee.shift?.name || 'Standard Shift',
        attendanceStatus: attendance?.status || null,
        hasTargets: activeTargets.length > 0,
        excludedDay: perf.excludedDay,
        exclusionReason: perf.exclusionReason,
        overallScore: perf.overallScore,
        callConnectionRate: perf.callConnectionRate,
        leadConversionRate: perf.leadConversionRate,
        completedTargetsCount: perf.completedTargetsCount,
        assignedTargetsCount: perf.assignedTargetsCount,
        targets: activeTargets,
        stats,
        callVerificationLimitation: CALL_VERIFICATION_LIMITATION,
      },
    };
  }

  async getEmployeeAnalysis(
    user: any,
    customerId: number | string | undefined,
    query: { range?: string; fromDate?: string; toDate?: string; employeeId?: number },
  ) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const admin = isUserAdmin(user);
    const selfEmp = await this.resolveEmployeeForUser(user, numCustomerId);
    const targetEmpId = admin && query.employeeId ? Number(query.employeeId) : selfEmp?.id;
    if (!targetEmpId) throw new ForbiddenException('Employee profile not found');
    if (!admin && selfEmp && targetEmpId !== selfEmp.id) {
      throw new ForbiddenException('You can only view your own performance analysis.');
    }

    const todayStr = getBusinessDate(new Date());
    let fromDate = query.fromDate || todayStr;
    let toDate = query.toDate || todayStr;

    const range = (query.range || 'today').toLowerCase();
    if (range === 'yesterday') {
      const y = getBusinessDate(new Date(Date.now() - 86_400_000));
      fromDate = y;
      toDate = y;
    } else if (range === 'week') {
      fromDate = getBusinessDate(new Date(Date.now() - 6 * 86_400_000));
      toDate = todayStr;
    } else if (range === 'month') {
      fromDate = `${todayStr.slice(0, 8)}01`;
      toDate = todayStr;
    } else if (range === 'today') {
      fromDate = todayStr;
      toDate = todayStr;
    }

    if (fromDate === todayStr && toDate === todayStr) {
      await this.computeAndSaveDailySnapshot(numCustomerId, targetEmpId, todayStr);
    }

    const snapshots = await this.prisma.dailyPerformanceSnapshot.findMany({
      where: {
        customerId: numCustomerId,
        employeeId: targetEmpId,
        businessDate: { gte: fromDate, lte: toDate },
      },
      orderBy: { businessDate: 'asc' },
    });

    const metricAgg = new Map<string, { metricKey: string; metricLabel: string; target: number; actual: number }>();
    let outgoingCalls = 0;
    let connectedCalls = 0;
    let newLeads = 0;
    let leadsWon = 0;
    let completedTargets = 0;
    let missedTargets = 0;

    for (const snap of snapshots) {
      const totals = (snap.totals as Record<string, number>) || {};
      outgoingCalls += Number(totals.outgoingCalls || 0);
      connectedCalls += Number(totals.connectedCalls || 0);
      newLeads += Number(totals.newLeadsCreated || 0);
      leadsWon += Number(totals.leadsWon || 0);

      const breakdown = Array.isArray(snap.metricBreakdown) ? (snap.metricBreakdown as any[]) : [];
      for (const m of breakdown) {
        if (m.excluded) continue;
        if (Number(m.achievementPct || 0) >= 100) completedTargets += 1;
        else missedTargets += 1;

        const cur = metricAgg.get(m.metricKey) || {
          metricKey: m.metricKey,
          metricLabel: m.metricLabel,
          target: 0,
          actual: 0,
        };
        cur.target += Number(m.effectiveTarget || 0);
        cur.actual += Number(m.actual || 0);
        metricAgg.set(m.metricKey, cur);
      }
    }

    const avgScore =
      snapshots.length > 0
        ? round2(snapshots.reduce((s, r) => s + Number(r.overallScore || 0), 0) / snapshots.length)
        : 0;

    const reports = await this.prisma.dailyPerformanceReport.findMany({
      where: {
        customerId: numCustomerId,
        employeeId: targetEmpId,
        businessDate: { gte: fromDate, lte: toDate },
      },
      orderBy: [{ businessDate: 'desc' }, { reportVersion: 'desc' }],
    });

    return {
      success: true,
      data: {
        employeeId: targetEmpId,
        fromDate,
        toDate,
        overallScore: avgScore,
        completedTargets,
        missedTargets,
        callConnectionRate: outgoingCalls > 0 ? round2((connectedCalls / outgoingCalls) * 100) : 0,
        leadConversionRate: newLeads > 0 ? round2((leadsWon / newLeads) * 100) : 0,
        metricsSummary: Array.from(metricAgg.values()).map((m) => ({
          ...m,
          achievementPct: m.target > 0 ? round2((m.actual / m.target) * 100) : 0,
        })),
        trends: snapshots.map((s) => ({
          businessDate: s.businessDate,
          overallScore: s.overallScore,
          callConnectionRate: s.callConnectionRate,
          leadConversionRate: s.leadConversionRate,
          workingHours: s.workingHours,
        })),
        reports: reports.map((r) => ({
          id: r.id,
          businessDate: r.businessDate,
          reportVersion: r.reportVersion,
          emailStatus: r.emailStatus,
          whatsappStatus: r.whatsappStatus,
        })),
        callVerificationLimitation: CALL_VERIFICATION_LIMITATION,
      },
    };
  }

  async getAdminDashboard(
    user: any,
    customerId: number | string | undefined,
    query: {
      employeeId?: number;
      departmentId?: number;
      fromDate?: string;
      toDate?: string;
      achievementStatus?: string;
    },
  ) {
    const numCustomerId = await this.resolveCustomerId(user, customerId);
    const todayStr = getBusinessDate(new Date());
    const fromDate = query.fromDate || todayStr;
    const toDate = query.toDate || todayStr;

    const employees = await this.prisma.employee.findMany({
      where: {
        customerId: numCustomerId,
        status: 'ACTIVE',
        ...(query.employeeId ? { id: Number(query.employeeId) } : {}),
        ...(query.departmentId ? { departmentId: Number(query.departmentId) } : {}),
      },
      include: { department: true, shift: true },
      orderBy: { firstName: 'asc' },
    });

    if (fromDate === todayStr && toDate === todayStr) {
      for (const emp of employees) {
        const hasTargets = await this.prisma.telecallerTargetAssignment.count({
          where: {
            customerId: numCustomerId,
            isActive: true,
            OR: [{ employeeId: emp.id }, ...(emp.departmentId ? [{ departmentId: emp.departmentId }] : [])],
          },
        });
        if (hasTargets > 0) {
          await this.computeAndSaveDailySnapshot(numCustomerId, emp.id, todayStr);
        }
      }
    }

    const snapshots = await this.prisma.dailyPerformanceSnapshot.findMany({
      where: {
        customerId: numCustomerId,
        employeeId: { in: employees.map((e) => e.id) },
        businessDate: { gte: fromDate, lte: toDate },
      },
      orderBy: { businessDate: 'asc' },
    });

    const reports = await this.prisma.dailyPerformanceReport.findMany({
      where: {
        customerId: numCustomerId,
        employeeId: { in: employees.map((e) => e.id) },
        businessDate: { gte: fromDate, lte: toDate },
      },
      orderBy: [{ businessDate: 'desc' }, { reportVersion: 'desc' }],
    });

    const rewardLedgers = await this.prisma.telecallerRewardLedger.findMany({
      where: {
        customerId: numCustomerId,
        employeeId: { in: employees.map((e) => e.id) },
        businessDate: { gte: fromDate, lte: toDate },
      },
    });

    const rows = employees
      .map((emp) => {
        const empSnaps = snapshots.filter((s) => s.employeeId === emp.id);
        let assigned = 0;
        let achieved = 0;
        for (const s of empSnaps) {
          const list = Array.isArray(s.metricBreakdown) ? (s.metricBreakdown as any[]) : [];
          for (const m of list) {
            if (m.excluded) continue;
            assigned += Number(m.effectiveTarget || 0);
            achieved += Number(m.actual || 0);
          }
        }
        const pending = Math.max(0, round2(assigned - achieved));
        const overallScore =
          empSnaps.length > 0
            ? round2(empSnaps.reduce((a, b) => a + Number(b.overallScore || 0), 0) / empSnaps.length)
            : 0;
        const latest = empSnaps[empSnaps.length - 1];
        const status =
          assigned === 0
            ? 'UNASSIGNED'
            : overallScore > 100
              ? 'EXCEEDED'
              : overallScore >= 100
                ? 'COMPLETED'
                : achieved > 0
                  ? 'IN_PROGRESS'
                  : 'NOT_STARTED';

        const latestReport = reports.find((r) => r.employeeId === emp.id);
        const rewardPoints = rewardLedgers
          .filter((rl) => rl.employeeId === emp.id)
          .reduce((sum, rl) => sum + Number(rl.points || 0), 0);
        return {
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
          department: emp.department?.name || 'General',
          shiftName: emp.shift?.name || 'Standard Shift',
          attendanceStatus: latest?.attendanceStatus || 'NOT_RECORDED',
          assignedTargets: round2(assigned),
          actualAchievements: round2(achieved),
          pendingTargets: pending,
          overallScore,
          rewardPoints,
          callConnectionRate: latest?.callConnectionRate ?? 0,
          leadConversionRate: latest?.leadConversionRate ?? 0,
          status,
          latestReportId: latestReport?.id ?? null,
          emailStatus: latestReport?.emailStatus ?? null,
          whatsappStatus: latestReport?.whatsappStatus ?? null,
        };
      })
      .filter((r) => {
        if (query.achievementStatus && query.achievementStatus !== 'ALL') {
          return r.status === query.achievementStatus;
        }
        return r.assignedTargets > 0 || r.actualAchievements > 0;
      });

    return {
      success: true,
      data: {
        fromDate,
        toDate,
        rows,
        callVerificationLimitation: CALL_VERIFICATION_LIMITATION,
      },
    };
  }

  async exportAdminDashboard(
    user: any,
    customerId: number | string | undefined,
    query: {
      format?: string;
      employeeId?: number;
      departmentId?: number;
      fromDate?: string;
      toDate?: string;
      achievementStatus?: string;
    },
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const dashboard = await this.getAdminDashboard(user, customerId, query);
    const { rows, fromDate, toDate } = dashboard.data;
    const format = (query.format || 'csv').toLowerCase();

    if (format === 'xlsx' || format === 'excel') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Telecaller Performance');
      const startRow = applyExcelBranding(
        wb,
        ws,
        'Telecaller Performance Report',
        `Period: ${fromDate} to ${toDate}`,
      );
      const headers = [
        'Employee ID',
        'Employee Name',
        'Department',
        'Shift',
        'Attendance',
        'Assigned',
        'Achieved',
        'Pending',
        'Overall %',
        'Status',
      ];
      const headerRow = ws.getRow(startRow);
      headerRow.values = headers;
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF107569' } };
      [14, 24, 18, 18, 14, 12, 12, 12, 12, 14].forEach((w, idx) => {
        ws.getColumn(idx + 1).width = w;
      });
      rows.forEach((r) =>
        ws.addRow([
          r.employeeCode,
          r.employeeName,
          r.department,
          r.shiftName,
          r.attendanceStatus,
          r.assignedTargets,
          r.actualAchievements,
          r.pendingTargets,
          r.overallScore,
          r.status,
        ]),
      );
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      return {
        buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `telecaller-performance-${fromDate}-to-${toDate}.xlsx`,
      };
    }

    if (format === 'pdf') {
      const numCustomerId = await this.resolveCustomerId(user, customerId);
      const customer = await this.prisma.customer.findUnique({
        where: { id: numCustomerId },
        select: { companyName: true, name: true },
      });
      const buffer = await renderDailyPerformancePdf({
        companyName: customer?.companyName || customer?.name || 'QB Suite',
        reportDate: `${fromDate} to ${toDate}`,
        reportVersion: 1,
        generatedAt: new Date(),
        employeeName: `Team Performance Summary (${rows.length} Employees)`,
        employeeCode: 'ALL',
        department: 'Telecalling & CRM',
        designation: 'Admin Export',
        shiftName: 'All Shifts',
        shiftTimings: '-',
        punchInText: '-',
        punchOutText: '-',
        workingHoursText: '-',
        overallScore:
          rows.length > 0
            ? round2(rows.reduce((s, r) => s + r.overallScore, 0) / rows.length)
            : 0,
        callConnectionRate:
          rows.length > 0
            ? round2(rows.reduce((s, r) => s + r.callConnectionRate, 0) / rows.length)
            : 0,
        leadConversionRate:
          rows.length > 0
            ? round2(rows.reduce((s, r) => s + r.leadConversionRate, 0) / rows.length)
            : 0,
        metrics: rows.map((r) => ({
          metricKey: r.employeeCode,
          metricLabel: `${r.employeeName} (${r.department})`,
          periodType: 'RANGE',
          baseTarget: r.assignedTargets,
          effectiveTarget: r.assignedTargets,
          actual: r.actualAchievements,
          remaining: r.pendingTargets,
          achievementPct: r.overallScore,
          cappedContributionPct: Math.min(100, r.overallScore),
          weightage: null,
          status: (r.status === 'UNASSIGNED' ? 'NOT_STARTED' : r.status) as any,
          excluded: false,
        })),
        stats: {
          outgoingCalls: 0,
          connectedCalls: 0,
          followUpsCompleted: 0,
          newLeadsCreated: 0,
          visitsScheduled: 0,
          visitsCompleted: 0,
          proposalsSent: 0,
          leadsWon: 0,
        },
        callVerificationLimitation: CALL_VERIFICATION_LIMITATION,
      });
      return {
        buffer,
        mimeType: 'application/pdf',
        filename: `telecaller-performance-${fromDate}-to-${toDate}.pdf`,
      };
    }

    const header = [
      'Employee ID',
      'Employee Name',
      'Department',
      'Shift',
      'Attendance',
      'Assigned',
      'Achieved',
      'Pending',
      'Overall %',
      'Status',
    ].join(',');
    const lines = rows.map((r) =>
      [
        r.employeeCode,
        `"${r.employeeName.replace(/"/g, '""')}"`,
        `"${r.department.replace(/"/g, '""')}"`,
        `"${r.shiftName.replace(/"/g, '""')}"`,
        r.attendanceStatus,
        r.assignedTargets,
        r.actualAchievements,
        r.pendingTargets,
        r.overallScore,
        r.status,
      ].join(','),
    );
    return {
      buffer: Buffer.from([header, ...lines].join('\n'), 'utf8'),
      mimeType: 'text/csv',
      filename: `telecaller-performance-${fromDate}-to-${toDate}.csv`,
    };
  }

  /**
   * Idempotent background trigger invoked only on final shift punch-out.
   */
  async onFinalShiftPunchOut(customerId: number, employeeId: number, businessDate: string) {
    const policy = await this.getPolicy({ customerId }, customerId);
    if (!policy.autoSendOnFinalPunchOut) return null;

    const latestVersionRow = await this.prisma.dailyPerformanceReport.findFirst({
      where: { customerId, employeeId, businessDate },
      orderBy: { reportVersion: 'desc' },
      select: { id: true, reportVersion: true, snapshotData: true },
    });

    const computed = await this.computeAndSaveDailySnapshot(customerId, employeeId, businessDate);
    if (!computed.perf.assignedTargetsCount && !computed.stats.outgoingCalls) {
      return null;
    }

    const nextVersion = latestVersionRow ? latestVersionRow.reportVersion + 1 : 1;
    const triggerKey = `perf-report:${customerId}:${employeeId}:${businessDate}:v${nextVersion}`;

    try {
      const report = await this.prisma.dailyPerformanceReport.create({
        data: {
          customerId,
          employeeId,
          businessDate,
          reportVersion: nextVersion,
          triggerKey,
          emailStatus: 'PENDING',
          whatsappStatus: 'PENDING',
          snapshotData: {
            overallScore: computed.perf.overallScore,
            callConnectionRate: computed.perf.callConnectionRate,
            leadConversionRate: computed.perf.leadConversionRate,
            metrics: computed.perf.metrics,
            stats: computed.stats,
          } as any,
        },
      });
      await this.dispatchReportDeliveries(report.id);
      return report;
    } catch (error: any) {
      if (error?.code === 'P2002') return null;
      throw error;
    }
  }

  async generateReportPdfBuffer(reportId: number): Promise<{ buffer: Buffer; filename: string; report: any }> {
    const report = await this.prisma.dailyPerformanceReport.findUnique({
      where: { id: reportId },
      include: {
        customer: { select: { id: true, name: true, companyName: true, logo: true } },
        employee: { include: { shift: true, department: true, designation: true } },
      },
    });
    if (!report) throw new NotFoundException(`Report #${reportId} not found`);

    const computed = await this.computeAndSaveDailySnapshot(
      report.customerId,
      report.employeeId,
      report.businessDate,
    );
    const emp = report.employee;
    const att = computed.attendance;
    const improvementAreas = computed.perf.metrics
      .filter((m) => !m.excluded && m.achievementPct < 100)
      .map((m) => `${m.metricLabel}: achieved ${m.actual}/${m.effectiveTarget} (${m.achievementPct.toFixed(1)}%)`);

    const summaryNotes = [
      `Overall daily performance score: ${computed.perf.overallScore.toFixed(1)}% across ${computed.perf.assignedTargetsCount} active target(s).`,
      `Completed ${computed.perf.completedTargetsCount} target(s); ${computed.perf.missedTargetsCount} target(s) below 100%.`,
    ];

    const buffer = await renderDailyPerformancePdf({
      companyName: report.customer?.companyName || report.customer?.name || 'QB Suite',
      reportDate: report.businessDate,
      reportVersion: report.reportVersion,
      generatedAt: new Date(),
      employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
      employeeCode: emp.employeeCode || `EMP-${emp.id}`,
      department: emp.department?.name || 'General',
      designation: emp.designation?.name || 'Telecaller',
      shiftName: emp.shift?.name || 'Standard Shift',
      shiftTimings: `${computed.breakdown.shiftStartTime} - ${computed.breakdown.shiftEndTime}`,
      punchInText: att?.punchIn ? `${formatTimeInTimezone(new Date(att.punchIn))} IST` : 'N/A',
      punchOutText: att?.punchOut ? `${formatTimeInTimezone(new Date(att.punchOut))} IST` : 'N/A',
      workingHoursText: `${Number(att?.workingHours || 0).toFixed(2)} hrs`,
      overallScore: computed.perf.overallScore,
      callConnectionRate: computed.perf.callConnectionRate,
      leadConversionRate: computed.perf.leadConversionRate,
      metrics: computed.perf.metrics,
      stats: computed.stats,
      callVerificationLimitation: CALL_VERIFICATION_LIMITATION,
      summaryNotes,
      improvementAreas,
    });

    return {
      buffer,
      filename: `daily-performance-${emp.employeeCode || emp.id}-${report.businessDate}-v${report.reportVersion}.pdf`,
      report,
    };
  }

  async dispatchReportDeliveries(reportId: number, channels?: Array<'EMAIL' | 'WHATSAPP'>) {
    const { buffer, filename, report } = await this.generateReportPdfBuffer(reportId);
    const policy = await this.getPolicy({ customerId: report.customerId }, report.customerId);
    const emp = report.employee;

    let pdfUrl = report.pdfUrl;
    if (!pdfUrl && this.s3Service) {
      try {
        const uploaded = await (this.s3Service as any).uploadBuffer?.(
          buffer,
          `telecaller-reports/${report.customerId}/${filename}`,
          'application/pdf',
        );
        if (uploaded?.url) pdfUrl = uploaded.url;
      } catch (err: any) {
        this.logger.warn(`S3 upload skipped for report #${reportId}: ${err?.message}`);
      }
    }

    const sendEmail = !channels || channels.includes('EMAIL');
    const sendWa = !channels || channels.includes('WHATSAPP');
    const snapshotData = (report.snapshotData as any) || {};
    const score = Number(snapshotData.overallScore ?? 0).toFixed(1);

    if (sendEmail && report.emailStatus !== 'SENT') {
      if (!emp.email || !this.emailService) {
        await this.prisma.dailyPerformanceReport.update({
          where: { id: reportId },
          data: { emailStatus: 'SKIPPED', emailError: !emp.email ? 'No employee email registered' : 'Email service unavailable' },
        });
      } else {
        try {
          const subject = (policy.emailSubjectTemplate || 'Daily Performance Report - {{employeeName}} ({{reportDate}})')
            .replace('{{employeeName}}', `${emp.firstName} ${emp.lastName}`.trim())
            .replace('{{reportDate}}', report.businessDate)
            .replace('{{overallScore}}', `${score}%`);

          await this.emailService.sendEmail({
            to: emp.email,
            subject,
            html: `<p>Hello ${emp.firstName},</p><p>Please find attached your Daily Target &amp; Performance Report for <strong>${report.businessDate}</strong> (v${report.reportVersion}).</p><p><strong>Overall Performance Score:</strong> ${score}%</p>`,
            attachments: [{ filename, content: buffer }],
          } as any);

          await this.prisma.dailyPerformanceReport.update({
            where: { id: reportId },
            data: {
              pdfUrl: pdfUrl || report.pdfUrl,
              emailStatus: 'SENT',
              emailAttempts: { increment: 1 },
              emailSentAt: new Date(),
              emailError: null,
            },
          });
        } catch (err: any) {
          await this.prisma.dailyPerformanceReport.update({
            where: { id: reportId },
            data: {
              emailStatus: 'FAILED',
              emailAttempts: { increment: 1 },
              emailError: err?.message || 'Email delivery failed',
              nextRetryAt: new Date(Date.now() + 5 * 60_000),
            },
          });
        }
      }
    }

    if (sendWa && report.whatsappStatus !== 'SENT') {
      if (!emp.phone || !this.whatsappService) {
        await this.prisma.dailyPerformanceReport.update({
          where: { id: reportId },
          data: { whatsappStatus: 'SKIPPED', whatsappError: !emp.phone ? 'No employee phone registered' : 'WhatsApp service unavailable' },
        });
      } else {
        try {
          let waRes: any;
          if (policy.whatsappTemplateName) {
            const params = [
              { type: 'text' as const, text: `${emp.firstName} ${emp.lastName}`.trim() },
              { type: 'text' as const, text: report.businessDate },
              { type: 'text' as const, text: `${score}%` },
            ];
            waRes = await this.whatsappService.sendTemplate(
              emp.phone,
              policy.whatsappTemplateName,
              params,
              policy.whatsappLanguageCode || 'en_US',
              undefined,
              'DAILY_PERFORMANCE_REPORT',
              report.customerId,
              undefined,
              pdfUrl
                ? {
                    components: [
                      {
                        type: 'header',
                        parameters: [{ type: 'document', document: { link: pdfUrl, filename } }],
                      },
                    ],
                  }
                : undefined,
            );
          } else {
            waRes = await this.whatsappService.sendDocumentMessage({
              to: emp.phone,
              pdfBuffer: buffer,
              pdfUrl: pdfUrl || undefined,
              filename,
              caption: `Daily Performance Report (${report.businessDate}) - Score: ${score}%`,
              requireDocument: true,
            });
          }

          if (waRes?.success) {
            await this.prisma.dailyPerformanceReport.update({
              where: { id: reportId },
              data: {
                whatsappStatus: 'SENT',
                whatsappAttempts: { increment: 1 },
                whatsappSentAt: new Date(),
                whatsappError: null,
              },
            });
          } else {
            await this.prisma.dailyPerformanceReport.update({
              where: { id: reportId },
              data: {
                whatsappStatus: waRes?.skipped ? 'SKIPPED' : 'FAILED',
                whatsappAttempts: { increment: 1 },
                whatsappError: waRes?.error || waRes?.message || waRes?.reason || 'WhatsApp delivery failed',
                nextRetryAt: waRes?.skipped ? null : new Date(Date.now() + 5 * 60_000),
              },
            });
          }
        } catch (err: any) {
          await this.prisma.dailyPerformanceReport.update({
            where: { id: reportId },
            data: {
              whatsappStatus: 'FAILED',
              whatsappAttempts: { increment: 1 },
              whatsappError: err?.message || 'WhatsApp delivery failed',
              nextRetryAt: new Date(Date.now() + 5 * 60_000),
            },
          });
        }
      }
    }

    return this.prisma.dailyPerformanceReport.findUnique({ where: { id: reportId } });
  }

  async processPendingReportRetries() {
    if (this.retryBusy) return;
    this.retryBusy = true;
    try {
      const now = new Date();
      const pending = await this.prisma.dailyPerformanceReport.findMany({
        where: {
          nextRetryAt: { lte: now },
          OR: [{ emailStatus: 'FAILED' }, { whatsappStatus: 'FAILED' }],
        },
        take: 10,
      });

      for (const r of pending) {
        const policy = await this.getPolicy({ customerId: r.customerId }, r.customerId);
        const maxAttempts = Number(policy.maxRetryAttempts || 3);
        const channels: Array<'EMAIL' | 'WHATSAPP'> = [];
        if (r.emailStatus === 'FAILED' && r.emailAttempts < maxAttempts) channels.push('EMAIL');
        if (r.whatsappStatus === 'FAILED' && r.whatsappAttempts < maxAttempts) channels.push('WHATSAPP');

        if (channels.length === 0) {
          await this.prisma.dailyPerformanceReport.update({
            where: { id: r.id },
            data: { nextRetryAt: null },
          });
          continue;
        }
        await this.dispatchReportDeliveries(r.id, channels);
      }
    } finally {
      this.retryBusy = false;
    }
  }
}
