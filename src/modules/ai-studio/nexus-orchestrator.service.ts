import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { isUserAdmin } from '../../common/utils/role.util';
import { STANDARD_PERMISSIONS } from '../../common/constants/rbac.constants';
import { BUSINESS_TIMEZONE, formatTimeInTimezone, getBusinessDayRange } from '../../common/utils/timezone.util';

class NexusToolExecutionError extends Error {
  constructor(readonly toolName: string) {
    super(`QB Nexus could not retrieve data for ${toolName}.`);
    this.name = 'NexusToolExecutionError';
  }
}

export interface PendingActionProposal {
  id: string;
  type:
    | 'ASSIGN_LEADS'
    | 'UPDATE_LEAD_STATUS'
    | 'CREATE_TASK'
    | 'UPDATE_TASK_STATUS'
    | 'CREATE_FOLLOW_UP'
    | 'UPDATE_LEAVE_STATUS';
  title: string;
  description: string;
  payload: Record<string, any>;
  summary: Record<string, any>;
  createdAt: number;
  expiresAt: number;
}

export interface ExecutedActionResult {
  id: string;
  type: string;
  status: 'SUCCESS' | 'FAILED';
  message: string;
  details?: Record<string, any>;
}

export interface NexusResponse {
  answer: string;
  provider: string;
  pendingAction?: PendingActionProposal | null;
  executedAction?: ExecutedActionResult | null;
  suggestions?: string[];
}

interface SessionMemory {
  lastActive: number;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  lastLeadIds?: number[];
  lastEmployeeId?: number;
  lastEmployeeName?: string;
  lastTaskId?: number;
  pendingAction?: PendingActionProposal | null;
}

export const NEXUS_CAPABILITY_REGISTRY = [
  { module: 'CRM', capability: 'Search leads, details, pipeline, deals, customers, follow-ups, commissions', access: 'READ', verified: true },
  { module: 'CRM', capability: 'Assign leads, update lead status, schedule follow-ups', access: 'CONFIRMED_WRITE', verified: true },
  { module: 'HRM', capability: 'Search employees, employee profile, today attendance, monthly attendance report, leave requests, payroll runs, loans & claims', access: 'READ', verified: true },
  { module: 'HRM', capability: 'Approve or reject leave requests', access: 'CONFIRMED_WRITE', verified: true },
  { module: 'TASKS', capability: 'Search tasks, filter overdue, assignees', access: 'READ', verified: true },
  { module: 'TASKS', capability: 'Create tasks, update task status', access: 'CONFIRMED_WRITE', verified: true },
  { module: 'PRODUCTION', capability: 'Search work projects, shoots, status', access: 'READ', verified: true },
  { module: 'DATA_CAPTURE', capability: 'Capture job/place metrics and recent Google Places extractions', access: 'READ', verified: true },
  { module: 'COMMUNICATIONS', capability: 'WhatsApp campaigns, delivery metrics, company announcements', access: 'READ', verified: true },
  { module: 'REPORTS', capability: 'System reports catalog, Google Maps API quota and usage statistics', access: 'READ', verified: true },
  { module: 'DASHBOARD', capability: 'Cross-module KPI summary', access: 'READ', verified: true },
  { module: 'CROSS_MODULE', capability: 'Cross-module intelligence: leads on leave, conversion vs attendance, overdue tasks & attendance issues', access: 'READ', verified: true },
  { module: 'SYSTEM', capability: 'System roles, permissions, integration credentials (security protected: credentials never exposed)', access: 'PROTECTED_READ', verified: true },
] as const;

@Injectable()
export class NexusOrchestratorService {
  private readonly logger = new Logger(NexusOrchestratorService.name);
  private readonly sessions = new Map<string, SessionMemory>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSettingsService: IntegrationSettingsService,
  ) {
    // Periodically clean up expired sessions (older than 30 mins)
    setInterval(() => {
      const now = Date.now();
      for (const [key, session] of this.sessions.entries()) {
        if (now - session.lastActive > 30 * 60 * 1000) {
          this.sessions.delete(key);
        }
      }
    }, 5 * 60 * 1000).unref?.();
  }

  private getSessionKey(customerId: number, userId: number): string {
    return `${customerId}:${userId}`;
  }

  private getOrCreateSession(customerId: number, userId: number): SessionMemory {
    const key = this.getSessionKey(customerId, userId);
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        lastActive: Date.now(),
        history: [],
      };
      this.sessions.set(key, session);
    }
    session.lastActive = Date.now();
    return session;
  }

  // =========================================================================
  // MAIN ENTRY POINT
  // =========================================================================

  async processMessage(
    user: any,
    rawMessage: string,
    actionId?: string,
    confirm?: boolean,
    providerPolicy?: { primaryProvider?: string; fallbackProvider?: string },
  ): Promise<NexusResponse> {
    const customerId = Number(user?.customerId);
    const userId = Number(user?.id);
    if (!Number.isInteger(customerId) || customerId <= 0 || !Number.isInteger(userId) || userId <= 0) {
      throw new ForbiddenException('Your account is not scoped to a QB Suite business.');
    }

    const session = this.getOrCreateSession(customerId, userId);
    const message = String(rawMessage || '').trim();

    // 1. Check for Confirmation / Cancellation requests
    if (confirm !== undefined || actionId || (session.pendingAction && this.isConfirmationOrCancellation(message))) {
      const handled = await this.handleConfirmationFlow(user, customerId, userId, session, message, actionId, confirm);
      if (handled) return handled;
    }

    if (!message) {
      throw new BadRequestException('Please provide a question or instruction for QB Nexus.');
    }

    const unavailableCapability = this.getUnavailableBusinessCapability(message);
    if (unavailableCapability) {
      const answer = `I can’t verify ${unavailableCapability} through a supported QB Nexus capability yet. No business data was inferred.`;
      session.history.push({ role: 'user', content: message }, { role: 'assistant', content: answer });
      session.history = session.history.slice(-12);
      return { answer, provider: 'Nexus Operations Guard' };
    }

    // Append user message to conversation history
    session.history.push({ role: 'user', content: message });
    if (session.history.length > 12) {
      session.history = session.history.slice(-12);
    }

    const preferred = providerPolicy?.primaryProvider === 'GEMINI' ? 'GEMINI' : 'OPENAI';
    const fallback = providerPolicy?.fallbackProvider === 'DISABLED'
      ? null
      : providerPolicy?.fallbackProvider === 'OPENAI' || providerPolicy?.fallbackProvider === 'GEMINI'
        ? providerPolicy.fallbackProvider
        : preferred === 'OPENAI' ? 'GEMINI' : 'OPENAI';
    const runProvider = (provider: string) => provider === 'GEMINI'
      ? this.executeWithGemini(user, customerId, userId, session, message)
      : this.executeWithOpenAi(user, customerId, userId, session, message);
    const firstResult = await runProvider(preferred).catch((err) => {
      if (err instanceof NexusToolExecutionError) {
        return { answer: 'I could not retrieve that data from QB Suite right now. No result was assumed. Please retry in a moment.', provider: 'Nexus Operations Guard' };
      }
      this.logger.warn(`[NEXUS_ORCHESTRATOR] ${preferred} failed: ${err.message || err}`);
      return null;
    });
    if (firstResult) {
      session.history.push({ role: 'assistant', content: firstResult.answer });
      return firstResult;
    }
    const fallbackResult = fallback ? await runProvider(fallback).catch((err) => {
      if (err instanceof NexusToolExecutionError) {
        return { answer: 'I could not retrieve that data from QB Suite right now. No result was assumed. Please retry in a moment.', provider: 'Nexus Operations Guard' };
      }
      this.logger.warn(`[NEXUS_ORCHESTRATOR] ${fallback} fallback failed: ${err.message || err}`);
      return null;
    }) : null;
    if (fallbackResult) {
      session.history.push({ role: 'assistant', content: fallbackResult.answer });
      return fallbackResult;
    }

    // 4. Fallback to Deterministic Engine
    this.logger.log(`[NEXUS_ORCHESTRATOR] Using Deterministic Engine fallback`);
    const deterministicResult = await this.executeDeterministic(user, customerId, userId, session, message).catch((err) => ({
      answer: err instanceof ForbiddenException ? err.message : 'I could not retrieve that data from QB Suite right now. No result was assumed. Please retry in a moment.',
      provider: 'Nexus Operations Guard',
    }));
    session.history.push({ role: 'assistant', content: deterministicResult.answer });
    return deterministicResult;
  }

  // =========================================================================
  // CONFIRMATION WORKFLOW ENGINE
  // =========================================================================

  private isConfirmationOrCancellation(message: string): boolean {
    return this.isConfirmation(message) || this.isCancellation(message);
  }

  private isConfirmation(message: string): boolean {
    return /^(confirm|yes|proceed|do it|sure|approved|execute|confirm action)$/i.test(message.trim());
  }

  private isCancellation(message: string): boolean {
    return /^(cancel|abort|stop|no|reject|dismiss|never mind|cancel action)$/i.test(message.trim());
  }

  private hasPermission(user: any, module: string, action: string): boolean {
    if (isUserAdmin(user)) return true;
    const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
    const normalize = (value: unknown) => String(value || '').toUpperCase().replace(/^EMPLOYEE\./, '').replace(/[._\s-]/g, '');
    const targetModule = normalize(module);
    const targetAction = normalize(action);
    const hasDirectPermission = permissions.some((permission: any) => {
      if (typeof permission === 'string') {
        const [grantedModuleRaw, grantedActionRaw] = permission.split(':');
        permission = { module: grantedModuleRaw, action: grantedActionRaw };
      }
      const grantedModule = normalize(permission?.module || permission?.code?.split(':')?.[0]);
      const grantedAction = normalize(permission?.action || permission?.code?.split(':')?.[1]);
      const moduleMatches = grantedModule === targetModule || grantedModule.replace(/S$/, '') === targetModule.replace(/S$/, '');
      const actionMatches = grantedAction === targetAction || grantedAction === 'ALL' || grantedAction === 'MANAGE'
        || (action === 'VIEW' && grantedAction === 'READ')
        || (action === 'CREATE' && grantedAction === 'CREATE')
        || (action === 'EDIT' && (grantedAction === 'EDIT' || grantedAction === 'UPDATE'))
        || (action === 'CHANGE_STAGE' && (grantedAction === 'CHANGE_STAGE' || grantedAction === 'EDIT'));
      return moduleMatches && actionMatches;
    });
    if (hasDirectPermission) return true;
    const employeeOverrides = user?.employee?.employeeModuleOverrides || [];
    const hasEmployeeOverride = employeeOverrides.some((override: any) => {
      const grantedModule = normalize(override?.module || override?.moduleKey || override?.permission?.module);
      const moduleMatches = grantedModule === targetModule || grantedModule.replace(/S$/, '') === targetModule.replace(/S$/, '');
      const grantedAction = normalize(override?.action || override?.permission?.action);
      const actionMatches = grantedAction === targetAction || grantedAction === 'ALL' || grantedAction === 'MANAGE'
        || (action === 'VIEW' && grantedAction === 'READ')
        || (action === 'CREATE' && grantedAction === 'CREATE')
        || (action === 'EDIT' && (grantedAction === 'EDIT' || grantedAction === 'UPDATE'))
        || (action === 'CHANGE_STAGE' && (grantedAction === 'CHANGE_STAGE' || grantedAction === 'EDIT'));
      return moduleMatches && actionMatches;
    });
    if (hasEmployeeOverride) return true;
    const hasRolePermission = (user?.userRoles || []).some((userRole: any) =>
      (userRole?.role?.rolePermissions || []).some((rolePermission: any) => {
        const permission = rolePermission?.permission || rolePermission;
        const grantedModule = normalize(permission?.module);
        const grantedAction = normalize(permission?.action);
        const moduleMatches = grantedModule === targetModule || grantedModule.replace(/S$/, '') === targetModule.replace(/S$/, '');
        const actionMatches = grantedAction === targetAction || grantedAction === 'ALL' || grantedAction === 'MANAGE'
          || (action === 'VIEW' && grantedAction === 'READ')
          || (action === 'CREATE' && grantedAction === 'CREATE')
          || (action === 'EDIT' && (grantedAction === 'EDIT' || grantedAction === 'UPDATE'))
          || (action === 'CHANGE_STAGE' && (grantedAction === 'CHANGE_STAGE' || grantedAction === 'EDIT'));
        return moduleMatches && actionMatches;
      }),
    );
    return hasRolePermission;
  }

  private requirePermission(user: any, module: string, action: string): void {
    if (!this.hasPermission(user, module, action)) {
      throw new ForbiddenException(`Access denied: missing ${module}:${action} permission.`);
    }
  }

  private canViewEmployeeDirectory(user: any): boolean {
    return isUserAdmin(user)
      || this.hasPermission(user, 'DASHBOARD', 'CARD_EMPLOYEES');
  }

  private parseOptionalDate(value: unknown, label: string): Date | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${label} must be a valid date.`);
    return date;
  }

  getCapabilityRegistry() {
    return { permissions: STANDARD_PERMISSIONS, nexus: NEXUS_CAPABILITY_REGISTRY };
  }

  private async handleConfirmationFlow(
    user: any,
    customerId: number,
    userId: number,
    session: SessionMemory,
    message: string,
    actionId?: string,
    confirm?: boolean,
  ): Promise<NexusResponse | null> {
    const pending = session.pendingAction;
    if (!pending) {
      if (confirm !== undefined || actionId) {
        return {
          answer: 'There is no pending action to confirm or cancel right now.',
          provider: 'Nexus Operations Guard',
          suggestions: ['Show today’s pending leads', 'Today’s attendance summary', 'View open tasks'],
        };
      }
      return null;
    }

    if (confirm !== true && !this.isConfirmation(message) && !this.isCancellation(message) && !actionId) {
      return null;
    }

    // Validate actionId if specified
    if (actionId && pending.id !== actionId) {
      return {
        answer: 'The specified action request has expired or does not match the active pending action.',
        provider: 'Nexus Operations Guard',
      };
    }

    // Check expiration (5 minutes TTL)
    if (Date.now() > pending.expiresAt) {
      session.pendingAction = null;
      return {
        answer: 'The pending confirmation has expired for safety. Please re-issue your command.',
        provider: 'Nexus Operations Guard',
      };
    }

    const isCancel = confirm === false || /^(cancel|abort|stop|no|reject|dismiss|never mind|cancel action)$/i.test(message.trim());
    if (isCancel) {
      session.pendingAction = null;
      return {
        answer: `Action "${pending.title}" has been cancelled. No changes were made to your data.`,
        provider: 'Nexus Operations Guard',
        suggestions: ['Show today’s pending leads', 'View open tasks'],
      };
    }

    const isConfirm = confirm === true || /^(confirm|yes|proceed|do it|sure|approved|execute|confirm action)$/i.test(message.trim());
    if (isConfirm) {
      const executed = await this.executePendingAction(user, customerId, userId, pending);
      session.pendingAction = null;
      return {
        answer: executed.message,
        provider: 'Nexus Operations Guard',
        executedAction: executed,
        suggestions: ['Show pending leads', 'View open tasks', 'Today’s attendance summary'],
      };
    }

    return null;
  }

  private async executePendingAction(
    user: any,
    customerId: number,
    userId: number,
    action: PendingActionProposal,
  ): Promise<ExecutedActionResult> {
    const userName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.email || `User #${userId}`;
    const userRole = String(user?.role || 'ADMIN');

    try {
      if (action.type === 'ASSIGN_LEADS') {
        this.requirePermission(user, 'LEADS', 'EDIT');
        const { leadIds, employeeId, userId: assigneeUserId, employeeName } = action.payload;
        if (!Array.isArray(leadIds) || leadIds.length === 0 || leadIds.length > 20 || new Set(leadIds).size !== leadIds.length) {
          throw new BadRequestException('No lead IDs provided for assignment.');
        }

        const targetEmployee = await this.prisma.employee.findFirst({
          where: { id: employeeId, customerId, status: 'ACTIVE' },
          select: { id: true, userId: true, firstName: true, lastName: true },
        });
        if (!targetEmployee || targetEmployee.userId !== assigneeUserId) throw new BadRequestException('The assignee is no longer active or eligible. Please create a new proposal.');

        // Verify all leads belong to this customer
        const verifiedLeads = await this.prisma.lead.findMany({
          where: { id: { in: leadIds }, customerId, deletedAt: null, status: { notIn: ['WON', 'LOST', 'CANCELLED', 'CONVERTED'] } },
          select: { id: true, title: true, firstName: true, lastName: true, companyName: true, assignedToId: true },
        });

        if (verifiedLeads.length !== leadIds.length) {
          throw new BadRequestException('One or more proposed leads no longer exist. No leads were assigned; please run the search again.');
        }

        if (!isUserAdmin(user) && verifiedLeads.some((lead) => lead.assignedToId !== userId)) {
          throw new BadRequestException('One or more proposed leads are no longer assigned to you. No leads were assigned; please search again.');
        }

        const validIds = verifiedLeads.map((l) => l.id);

        // Execute DB updates
        const assignment = await this.prisma.lead.updateMany({
          where: { id: { in: validIds }, customerId, deletedAt: null, status: { notIn: ['WON', 'LOST', 'CANCELLED', 'CONVERTED'] }, ...(!isUserAdmin(user) ? { assignedToId: userId } : {}) },
          data: {
            assignedToId: assigneeUserId || null,
            employeeId: employeeId || null,
            updatedAt: new Date(),
          },
        });
        if (assignment.count !== validIds.length) throw new BadRequestException('The leads changed before assignment. No assignment was completed; please search again.');

        // Add timeline entries
        for (const lead of verifiedLeads) {
          const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || lead.companyName || lead.title || `#${lead.id}`;
          await this.prisma.leadActivityTimeline.create({
            data: {
              leadId: lead.id,
              action: 'LEAD_ASSIGNED',
              description: `Lead assigned to ${employeeName} via QB Nexus by ${userName}.`,
              metadata: {
                assignedBy: userName,
                assignedToEmployeeId: employeeId,
                assignedToUserId: assigneeUserId,
                leadName,
              },
            },
          }).catch(() => null);
        }

        // Create Audit Log
        await this.prisma.auditLog.create({
          data: {
            customerId,
            userId,
            userName,
            userRole,
            source: 'ADMIN_PANEL',
            action: 'ASSIGN_LEADS',
            module: 'CRM',
            description: `QB Nexus assigned ${validIds.length} lead(s) to ${employeeName}.`,
            entityType: 'Lead',
            entityId: validIds.join(','),
            endpoint: '/admin/ai/nexus/chat',
            method: 'POST',
            status: 'SUCCESS',
            details: {
              leadIds: validIds,
              employeeId,
              assigneeUserId,
              employeeName,
              count: validIds.length,
            },
          },
        }).catch((err) => this.logger.warn(`Failed to write AuditLog: ${err?.message}`));

        return {
          id: action.id,
          type: action.type,
          status: 'SUCCESS',
          message: `Successfully assigned ${validIds.length} lead(s) to ${employeeName}. All activities and audit logs have been recorded.`,
          details: { validIds, employeeName, count: validIds.length },
        };
      }

      if (action.type === 'CREATE_TASK') {
        this.requirePermission(user, 'TASKS', 'CREATE');
        const { title, description, priority, dueDate, assigneeUserId, employeeId, assigneeName } = action.payload;

        if (!String(title || '').trim() || String(title).length > 180) throw new BadRequestException('Task title is invalid.');
        if (!['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(priority).toUpperCase())) throw new BadRequestException('Task priority is invalid.');
        if (dueDate && !Number.isFinite(new Date(dueDate).getTime())) throw new BadRequestException('Task due date is invalid.');
        if (employeeId) {
          const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, customerId, status: 'ACTIVE' }, select: { id: true, userId: true } });
          if (!employee || employee.userId !== assigneeUserId) throw new BadRequestException('The assignee is no longer active or eligible. Please create a new proposal.');
        }

        const task = await this.prisma.task.create({
          data: {
            customerId,
            title,
            description: description || null,
            priority: priority || 'MEDIUM',
            status: 'PENDING',
            dueDate: dueDate ? new Date(dueDate) : null,
            createdById: userId,
            assignedToId: assigneeUserId || null,
            employeeId: employeeId || null,
          },
        });

        // Audit Log
        await this.prisma.auditLog.create({
          data: {
            customerId,
            userId,
            userName,
            userRole,
            source: 'ADMIN_PANEL',
            action: 'CREATE_TASK',
            module: 'Tasks',
            description: `QB Nexus created task "${title}" assigned to ${assigneeName || 'unassigned'}.`,
            entityType: 'Task',
            entityId: String(task.id),
            endpoint: '/admin/ai/nexus/chat',
            method: 'POST',
            status: 'SUCCESS',
            details: { taskId: task.id, title, priority, assigneeName },
          },
        }).catch(() => null);

        return {
          id: action.id,
          type: action.type,
          status: 'SUCCESS',
          message: `Task "${title}" (#${task.id}) has been created successfully${assigneeName ? ` and assigned to ${assigneeName}` : ''}.`,
          details: { taskId: task.id, title },
        };
      }

      if (action.type === 'UPDATE_LEAD_STATUS') {
        this.requirePermission(user, 'LEADS', 'CHANGE_STAGE');
        const { leadId, status, oldStatus } = action.payload;
        const validStatuses = ['NEW', 'CONTACTED', 'CALL_BACK', 'DETAILS_SENT', 'FOLLOW_UP', 'VISIT_SCHEDULED', 'VISIT_DONE', 'PROPOSAL_SENT', 'NEGOTIATION', 'FINAL_CALL', 'WON', 'LOST', 'CANCELLED'];
        if (!validStatuses.includes(status)) throw new BadRequestException('The requested lead status is not supported.');
        const updated = await this.prisma.lead.updateMany({
          where: { id: leadId, customerId, deletedAt: null, status: oldStatus },
          data: { status, updatedAt: new Date() },
        });
        if (updated.count !== 1) throw new BadRequestException('The lead changed since the proposal. No update was made; please reload the lead.');

        await this.prisma.leadStatusHistory.create({
          data: {
            leadId,
            fromStatus: oldStatus || null,
            toStatus: status,
            changedById: userId,
            notes: `Status updated via QB Nexus by ${userName}`,
          },
        }).catch(() => null);

        await this.prisma.leadActivityTimeline.create({
          data: {
            leadId,
            action: 'STATUS_CHANGED',
            description: `Lead status changed from ${oldStatus || 'unknown'} to ${status} by QB Nexus.`,
            metadata: { changedBy: userName, newStatus: status },
          },
        }).catch(() => null);

        await this.prisma.auditLog.create({
          data: {
            customerId,
            userId,
            userName,
            userRole,
            source: 'ADMIN_PANEL',
            action: 'UPDATE_LEAD_STATUS',
            module: 'CRM',
            description: `QB Nexus updated Lead #${leadId} status to ${status}.`,
            entityType: 'Lead',
            entityId: String(leadId),
            endpoint: '/admin/ai/nexus/chat',
            method: 'POST',
            status: 'SUCCESS',
            details: { leadId, oldStatus, newStatus: status },
          },
        }).catch(() => null);

        return {
          id: action.id,
          type: action.type,
          status: 'SUCCESS',
          message: `Lead #${leadId} status has been updated to "${status}".`,
          details: { leadId, newStatus: status },
        };
      }

      if (action.type === 'UPDATE_TASK_STATUS') {
        this.requirePermission(user, 'TASKS', 'UPDATE');
        const { taskId, status, oldStatus } = action.payload;
        const updated = await this.prisma.task.updateMany({
          where: { id: taskId, customerId, deletedAt: null, status: oldStatus },
          data: {
            status,
            ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
            updatedAt: new Date(),
          },
        });
        if (updated.count !== 1) throw new BadRequestException('The task changed since the proposal. No update was made; please reload the task.');

        await this.prisma.taskHistory.create({
          data: {
            taskId,
            action: 'STATUS_UPDATED',
            performedById: userId,
            performedByName: userName,
            oldStatus,
            newStatus: status,
            comment: `Status updated via QB Nexus`,
          },
        }).catch(() => null);

        await this.prisma.auditLog.create({
          data: {
            customerId,
            userId,
            userName,
            userRole,
            source: 'ADMIN_PANEL',
            action: 'UPDATE_TASK_STATUS',
            module: 'Tasks',
            description: `QB Nexus updated Task #${taskId} status to ${status}.`,
            entityType: 'Task',
            entityId: String(taskId),
            endpoint: '/admin/ai/nexus/chat',
            method: 'POST',
            status: 'SUCCESS',
            details: { taskId, oldStatus, newStatus: status },
          },
        }).catch(() => null);

        return {
          id: action.id,
          type: action.type,
          status: 'SUCCESS',
          message: `Task #${taskId} status has been changed to "${status}".`,
          details: { taskId, newStatus: status },
        };
      }

      if (action.type === 'CREATE_FOLLOW_UP') {
        this.requirePermission(user, 'LEADS', 'EDIT');
        const { leadId, title, remindAt } = action.payload;
        const verifiedLead = await this.prisma.lead.findFirst({
          where: { id: leadId, customerId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, companyName: true },
        });
        if (!verifiedLead) throw new BadRequestException('Lead not found.');
        const reminder = await this.prisma.leadReminder.create({
          data: {
            leadId,
            title: title || 'Follow up with lead',
            remindAt: new Date(remindAt),
          },
        });
        await this.prisma.leadActivityTimeline.create({
          data: {
            leadId,
            action: 'REMINDER_CREATED',
            description: `Follow-up scheduled for ${new Date(remindAt).toLocaleString('en-IN')}: ${title}`,
            metadata: { reminderId: reminder.id, createdBy: userName },
          },
        }).catch(() => null);
        await this.prisma.auditLog.create({
          data: {
            customerId,
            userId,
            userName,
            userRole,
            source: 'ADMIN_PANEL',
            action: 'CREATE_FOLLOW_UP',
            module: 'CRM',
            description: `QB Nexus scheduled follow-up for Lead #${leadId}.`,
            entityType: 'LeadReminder',
            entityId: String(reminder.id),
            endpoint: '/admin/ai/nexus/chat',
            method: 'POST',
            status: 'SUCCESS',
            details: { leadId, reminderId: reminder.id, remindAt },
          },
        }).catch(() => null);
        return {
          id: action.id,
          type: action.type,
          status: 'SUCCESS',
          message: `Follow-up reminder has been scheduled for Lead #${leadId} on ${new Date(remindAt).toLocaleDateString('en-IN')}.`,
          details: { reminderId: reminder.id, leadId },
        };
      }

      if (action.type === 'UPDATE_LEAVE_STATUS') {
        this.requirePermission(user, 'LEAVE', 'EDIT');
        const { leaveId, status, reviewNote } = action.payload;
        const leave = await this.prisma.leaveRequest.findFirst({
          where: { id: leaveId, customerId },
          include: { employee: { select: { firstName: true, lastName: true } } },
        });
        if (!leave) throw new BadRequestException('Leave request not found.');
        await this.prisma.leaveRequest.update({
          where: { id: leaveId },
          data: {
            status,
            rejectionReason: status === 'REJECTED' ? (reviewNote || 'Rejected via QB Nexus') : undefined,
            updatedAt: new Date(),
          },
        });
        await this.prisma.auditLog.create({
          data: {
            customerId,
            userId,
            userName,
            userRole,
            source: 'ADMIN_PANEL',
            action: 'UPDATE_LEAVE_STATUS',
            module: 'HRM',
            description: `QB Nexus updated Leave Request #${leaveId} for ${leave.employee?.firstName || 'staff'} to ${status}.`,
            entityType: 'LeaveRequest',
            entityId: String(leaveId),
            endpoint: '/admin/ai/nexus/chat',
            method: 'POST',
            status: 'SUCCESS',
            details: { leaveId, status },
          },
        }).catch(() => null);
        return {
          id: action.id,
          type: action.type,
          status: 'SUCCESS',
          message: `Leave request #${leaveId} for ${leave.employee?.firstName || 'staff'} has been marked as ${status}.`,
          details: { leaveId, status },
        };
      }

      throw new BadRequestException(`Unsupported action type: ${action.type}`);
    } catch (error: any) {
      this.logger.error(`[NEXUS_EXECUTION_ERROR] Failed to execute action ${action.id}: ${error.message}`);
      return {
        id: action.id,
        type: action.type,
        status: 'FAILED',
        message: `Action execution failed: ${error.message || 'Unknown database error'}`,
      };
    }
  }

  // =========================================================================
  // TOOL DEFINITIONS (Standard JSON Schema)
  // =========================================================================

  private getToolDeclarations() {
    return [
      {
        name: 'crm_search_leads',
        description: 'Search and filter CRM leads by status, priority, or search keyword. Returns counts and top matching leads.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Lead status filter e.g. NEW, CONTACTED, PENDING, WON, LOST, etc. If omitted or PENDING, returns open pending leads.' },
            priority: { type: 'string', description: 'Priority filter: LOW, MEDIUM, HIGH, URGENT' },
            query: { type: 'string', description: 'Keyword search across lead name, company, email, or phone' },
            source: { type: 'string', description: 'Lead source exact match, for example GOOGLE_PLACES' },
            missingPhone: { type: 'boolean', description: 'Only return leads without a phone number' },
            createdAfter: { type: 'string', description: 'Only records created at or after this ISO date' },
            createdBefore: { type: 'string', description: 'Only records created before this ISO date' },
            sortBy: { type: 'string', enum: ['createdAt', 'value', 'priority'], description: 'Sort field, defaults to newest first' },
            sortOrder: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction, defaults to descending' },
            offset: { type: 'integer', description: 'Number of records to skip (0 to 500)' },
            limit: { type: 'integer', description: 'Number of records to return (default 5, max 20)' },
            onlyUnassigned: { type: 'boolean', description: 'Set to true to only find unassigned leads' },
          },
        },
      },
      {
        name: 'crm_get_lead_details',
        description: 'Get complete details, stage, notes, and activity timeline for a specific lead by ID.',
        parameters: {
          type: 'object',
          properties: {
            leadId: { type: 'integer', description: 'The numeric ID of the lead' },
          },
          required: ['leadId'],
        },
      },
      {
        name: 'crm_pipeline_summary',
        description: 'Get CRM sales pipeline overview including counts by status/stage and total estimated deal value.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'crm_propose_assign_leads',
        description: 'Propose assigning leads to a staff member. SENSITIVE: Generates a confirmation proposal that requires user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            employeeNameOrId: { type: 'string', description: 'The name or numeric employee ID of the staff member to assign leads to (e.g. "Rahul", "Priya")' },
            count: { type: 'integer', description: 'Number of leads to assign (default 5)' },
            leadIds: { type: 'array', items: { type: 'integer' }, description: 'Explicit lead IDs to assign if specified' },
          },
          required: ['employeeNameOrId'],
        },
      },
      {
        name: 'crm_propose_update_lead_status',
        description: 'Propose updating a lead status. SENSITIVE: Generates a confirmation proposal.',
        parameters: {
          type: 'object',
          properties: {
            leadId: { type: 'integer', description: 'Numeric ID of the lead' },
            status: { type: 'string', description: 'Target status: NEW, CONTACTED, CALL_BACK, DETAILS_SENT, FOLLOW_UP, PROPOSAL_SENT, NEGOTIATION, WON, LOST, CANCELLED' },
          },
          required: ['leadId', 'status'],
        },
      },
      {
        name: 'hrm_search_employees',
        description: 'Search staff members and employees by name, department, employee code, or role.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Name, email, or employee code search query' },
            department: { type: 'string', description: 'Department name filter' },
            limit: { type: 'integer', description: 'Maximum staff records to return (default 5)' },
          },
        },
      },
      {
        name: 'hrm_get_attendance_today',
        description: 'Get real-time attendance figures for today: total active staff, present, late, absent, and checked-in list.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'hrm_get_leave_requests',
        description: 'Get leave requests for the business (pending or approved) with employee names, dates, and reasons.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Request status: PENDING, APPROVED, REJECTED (default PENDING)' },
            limit: { type: 'integer', description: 'Maximum records to return' },
          },
        },
      },
      {
        name: 'tasks_search',
        description: 'Search operational tasks by status (PENDING, IN_PROGRESS, COMPLETED), priority, or keyword.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Task status: PENDING, IN_PROGRESS, COMPLETED, CANCELLED' },
            priority: { type: 'string', description: 'Priority: LOW, MEDIUM, HIGH, URGENT' },
            query: { type: 'string', description: 'Title or description search query' },
            assignedTo: { type: 'string', description: 'Assignee name or employee ID' },
            overdue: { type: 'boolean', description: 'Only tasks with due date before today and not completed' },
            dueAfter: { type: 'string', description: 'Only tasks due on or after this ISO date' },
            dueBefore: { type: 'string', description: 'Only tasks due before this ISO date' },
            sortBy: { type: 'string', enum: ['createdAt', 'dueDate', 'priority'], description: 'Sort field' },
            sortOrder: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
            offset: { type: 'integer', description: 'Number of records to skip (0 to 500)' },
            limit: { type: 'integer', description: 'Maximum tasks to return (default 5)' },
          },
        },
      },
      {
        name: 'tasks_propose_create',
        description: 'Propose creating a new business task. SENSITIVE: Generates a confirmation proposal.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the task' },
            description: { type: 'string', description: 'Detailed description or notes' },
            priority: { type: 'string', description: 'LOW, MEDIUM, HIGH, or URGENT' },
            dueDate: { type: 'string', description: 'Due date in YYYY-MM-DD format if mentioned' },
            assigneeNameOrId: { type: 'string', description: 'Name or ID of staff member to assign this task to' },
          },
          required: ['title'],
        },
      },
      {
        name: 'tasks_propose_update_status',
        description: 'Propose updating the status of an existing task (e.g. mark as COMPLETED). SENSITIVE: Generates a confirmation proposal.',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'integer', description: 'The numeric ID of the task' },
            status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], description: 'The target status' },
          },
          required: ['taskId', 'status'],
        },
      },
      {
        name: 'crm_search_customers',
        description: 'Search customer accounts and businesses by name, company, email, phone, or status.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keyword matching customer name, company, email, or phone' },
            status: { type: 'string', description: 'Filter: ACTIVE, INACTIVE, ALL' },
            limit: { type: 'integer', description: 'Maximum records to return (default 5)' },
          },
        },
      },
      {
        name: 'crm_get_deals_summary',
        description: 'Get CRM sales deals overview, stage breakdown, total open deal pipeline value, won deals value, and recent deals.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', description: 'Maximum deals to list' },
          },
        },
      },
      {
        name: 'crm_get_follow_ups',
        description: 'Get upcoming, today, or overdue follow-up reminders and scheduled client visits.',
        parameters: {
          type: 'object',
          properties: {
            timeframe: { type: 'string', enum: ['TODAY', 'OVERDUE', 'UPCOMING', 'ALL'], description: 'Timeframe filter (default TODAY)' },
            limit: { type: 'integer', description: 'Maximum records to return' },
          },
        },
      },
      {
        name: 'crm_get_commissions_summary',
        description: 'Get sales commission metrics: total earned, approved, pending, and paid commissions.',
        parameters: {
          type: 'object',
          properties: {
            employeeNameOrId: { type: 'string', description: 'Optional employee name or ID filter' },
          },
        },
      },
      {
        name: 'crm_propose_create_follow_up',
        description: 'Propose scheduling a follow-up reminder for a CRM lead. SENSITIVE: Generates a confirmation proposal.',
        parameters: {
          type: 'object',
          properties: {
            leadId: { type: 'integer', description: 'The numeric lead ID' },
            title: { type: 'string', description: 'Reminder/follow-up title or note' },
            remindAt: { type: 'string', description: 'Date and time of reminder in ISO format (e.g. 2026-11-22T10:00:00Z)' },
          },
          required: ['leadId', 'remindAt'],
        },
      },
      {
        name: 'hrm_get_employee_details',
        description: 'Get detailed profile for a specific staff member: department, designation, contact, salary status.',
        parameters: {
          type: 'object',
          properties: {
            employeeNameOrId: { type: 'string', description: 'Staff member name, ID, or employee code' },
          },
          required: ['employeeNameOrId'],
        },
      },
      {
        name: 'hrm_get_attendance_report',
        description: 'Get monthly attendance statistics: present days, late marks, half-days, and absences for staff.',
        parameters: {
          type: 'object',
          properties: {
            month: { type: 'integer', description: 'Month number (1-12). If omitted, uses current month.' },
            year: { type: 'integer', description: 'Year (e.g. 2026). If omitted, uses current year.' },
            employeeNameOrId: { type: 'string', description: 'Optional employee name or ID filter' },
          },
        },
      },
      {
        name: 'hrm_get_payroll_summary',
        description: 'Get verified payroll runs, total gross pay, deductions, and net salary disbursement figures.',
        parameters: {
          type: 'object',
          properties: {
            month: { type: 'integer', description: 'Month number (1-12)' },
            year: { type: 'integer', description: 'Year (e.g. 2026)' },
          },
        },
      },
      {
        name: 'hrm_get_loans_and_claims',
        description: 'Get employee loans and expense reimbursement claims: requested, approved, pending, and disbursed amounts.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['ALL', 'LOANS', 'CLAIMS'], description: 'Filter records: ALL, LOANS, or CLAIMS' },
            status: { type: 'string', description: 'PENDING, APPROVED, REJECTED, or ALL' },
          },
        },
      },
      {
        name: 'hrm_propose_update_leave_status',
        description: 'Propose approving or rejecting an employee leave request. SENSITIVE: Generates a confirmation proposal.',
        parameters: {
          type: 'object',
          properties: {
            leaveId: { type: 'integer', description: 'Numeric ID of the leave request' },
            status: { type: 'string', enum: ['APPROVED', 'REJECTED'], description: 'Target approval status' },
            reviewNote: { type: 'string', description: 'Optional review note or reason' },
          },
          required: ['leaveId', 'status'],
        },
      },
      {
        name: 'projects_search',
        description: 'Search client work projects, shoots, and production tasks by status, work type, or staff assignee.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Status: SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED' },
            query: { type: 'string', description: 'Search keyword' },
          },
        },
      },
      {
        name: 'communications_summary',
        description: 'Get summary of WhatsApp marketing campaigns, recipient counts, delivery success rates, and company announcements.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['ALL', 'CAMPAIGNS', 'ANNOUNCEMENTS'], description: 'Filter type' },
          },
        },
      },
      {
        name: 'reports_get_catalog_and_stats',
        description: 'Get system report categories catalog and Google Maps API quota usage statistics.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'cross_module_intelligence',
        description: 'Execute multi-module business queries across CRM, HRM, and Tasks: LEADS_ON_LEAVE, STAFF_PERFORMANCE_ATTENDANCE, OVERDUE_TASKS_AND_FOLLOWUPS, STAFF_TASK_AND_ATTENDANCE_ISSUES.',
        parameters: {
          type: 'object',
          properties: {
            queryType: {
              type: 'string',
              enum: ['LEADS_ON_LEAVE', 'STAFF_PERFORMANCE_ATTENDANCE', 'OVERDUE_TASKS_AND_FOLLOWUPS', 'STAFF_TASK_AND_ATTENDANCE_ISSUES'],
              description: 'The cross-module query type',
            },
          },
          required: ['queryType'],
        },
      },
      {
        name: 'data_capture_stats',
        description: 'Get Data Capture metrics: total jobs, total places captured from Google Places, and recent jobs.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'dashboard_kpi_summary',
        description: 'Get high-level operations summary across CRM, HRM, Tasks, and Data Capture for business overview.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  // =========================================================================
  // TOOL EXECUTOR
  // =========================================================================

  private async executeVerifiedTool(
    name: string,
    args: any,
    user: any,
    customerId: number,
    userId: number,
    session: SessionMemory,
  ) {
    try {
      return await this.executeTool(name, args, user, customerId, userId, session);
    } catch (error: any) {
      this.logger.warn(`[NEXUS_TOOL_FAILURE] ${name}: ${error?.name || 'Error'}`);
      throw new NexusToolExecutionError(name);
    }
  }

  private isBusinessDataQuestion(message: string): boolean {
    return /\b(leads?|prospects?|crm|customers?|deals?|pipeline|sales|commission|follow.?ups?|tasks?|projects?|employees?|staff|attendance|punch|leave|payroll|payslips?|salary|loans?|expenses?|reimbursements?|reports?|revenue|invoice|data capture|captures?|campaigns?|notifications?|integrations?|settings|permissions|roles|visits?|workforce|business performance)\b/i.test(message);
  }

  private getUnavailableBusinessCapability(message: string): string | null {
    const unsupported: Array<[RegExp, string]> = [
      [/\b(drop table|truncate table|delete database|alter table|raw sql)\b/i, 'direct database schema modifications'],
      [/\b(database passwords?|secret key|jwt secret|database credentials?)\b/i, 'sensitive credential access (security protected)'],
    ];
    return unsupported.find(([pattern]) => pattern.test(message))?.[1] || null;
  }

  private renderVerifiedToolResults(results: Array<{ name: string; data: any }>): string {
    if (!results.length) return '';
    const lines: string[] = [];
    for (const { name, data } of results) {
      if (data?.error) {
        lines.push(String(data.error));
        continue;
      }
      switch (name) {
        case 'crm_search_leads': {
          const records = Array.isArray(data.leads) ? data.leads : [];
          lines.push(`Found ${Number(data.totalCount) || 0} matching open lead(s).`);
          for (const lead of records) lines.push(`#${lead.id} ${lead.name}${lead.company ? ` (${lead.company})` : ''} — ${lead.status}, ${lead.priority}, assigned to ${lead.assignedTo}.`);
          if (data.totalCount > records.length) lines.push(`Showing ${records.length} records from the matching result set.`);
          break;
        }
        case 'crm_get_lead_details':
          lines.push(`Lead #${data.id}: ${data.name || 'Unnamed'}${data.company ? `, ${data.company}` : ''}; status ${data.status}; stage ${data.stage}; priority ${data.priority}; assignee ${data.assignee}.`);
          break;
        case 'crm_pipeline_summary':
          lines.push(`Pipeline contains ${data.totalLeads} leads. Status counts: ${Object.entries(data.statusBreakdown || {}).map(([status, count]) => `${status}: ${count}`).join(', ') || 'none'}. Total pipeline value ${data.totalPipelineValue}; won value ${data.wonValue}.`);
          break;
        case 'crm_search_customers': {
          const customers = Array.isArray(data.customers) ? data.customers : [];
          lines.push(`Found ${Number(data.totalCustomers) || 0} matching customer account(s).`);
          for (const c of customers) lines.push(`#${c.id} ${c.name}${c.companyName ? ` (${c.companyName})` : ''} — ${c.status}, phone: ${c.phone || 'N/A'}, assigned to ${c.assignedEmployee || 'unassigned'}.`);
          break;
        }
        case 'crm_get_deals_summary': {
          lines.push(`CRM Deals Overview: Total Open Pipeline Value: ${data.totalPipelineValue} across ${data.totalOpenDeals} open deal(s). Won: ${data.wonDealsCount} (${data.wonValue}), Lost: ${data.lostDealsCount}.`);
          if (data.stageBreakdown && Object.keys(data.stageBreakdown).length) {
            lines.push(`Stages: ${Object.entries(data.stageBreakdown).map(([k, v]) => `${k}: ${v}`).join(', ')}.`);
          }
          if (Array.isArray(data.recentDeals) && data.recentDeals.length) {
            lines.push(`Top deals:`);
            for (const d of data.recentDeals) lines.push(`• #${d.id} "${d.title}" — ₹${d.amount.toLocaleString('en-IN')}, stage: ${d.stage}, assigned to: ${d.assignee}`);
          }
          break;
        }
        case 'crm_get_follow_ups': {
          lines.push(`Follow-up & Visits (${data.timeframe}): ${data.totalReminders} reminder(s), ${data.totalVisits} scheduled visit(s).`);
          if (Array.isArray(data.reminders) && data.reminders.length) {
            lines.push(`Reminders:`);
            for (const r of data.reminders) lines.push(`• [${r.remindAt}] Lead #${r.leadId} (${r.leadName}): ${r.title}`);
          }
          if (Array.isArray(data.visits) && data.visits.length) {
            lines.push(`Visits:`);
            for (const v of data.visits) lines.push(`• [${v.date} ${v.time || ''}] ${v.customerName}: ${v.purpose} (${v.location}) — status: ${v.status}`);
          }
          break;
        }
        case 'crm_get_commissions_summary': {
          lines.push(`Commission Overview: Total Earned: ₹${(data.totalEarned || 0).toLocaleString('en-IN')}, Approved: ₹${(data.approvedAmount || 0).toLocaleString('en-IN')}, Paid: ₹${(data.paidAmount || 0).toLocaleString('en-IN')}, Pending: ₹${(data.pendingAmount || 0).toLocaleString('en-IN')} across ${data.totalTransactions} transaction(s).`);
          break;
        }
        case 'hrm_search_employees': {
          const employees = Array.isArray(data.employees) ? data.employees : [];
          lines.push(`Found ${Number(data.totalCount) || 0} employee record(s) within your permitted scope.`);
          for (const employee of employees) lines.push(`${employee.name} (${employee.code})${employee.designation ? ` — ${employee.designation}` : ''}${employee.department ? `, ${employee.department}` : ''}.`);
          break;
        }
        case 'hrm_get_employee_details':
          lines.push(`Employee: ${data.name} (${data.employeeCode}) — Department: ${data.department || 'N/A'}, Designation: ${data.designation || 'N/A'}, Status: ${data.status}. Email: ${data.email || 'N/A'}, Phone: ${data.phone || 'N/A'}.`);
          break;
        case 'hrm_get_attendance_today':
          lines.push(data.totalStaff === undefined
            ? `Your attendance today as of ${data.asOf || formatTimeInTimezone(new Date(), BUSINESS_TIMEZONE)}: ${data.present} present, ${data.late} late, ${data.absent} marked absent, ${data.currentlyWorking} currently checked in.`
            : `Attendance as of ${data.asOf || formatTimeInTimezone(new Date(), BUSINESS_TIMEZONE)}: ${data.totalStaff} active staff, ${data.present} present, ${data.late} late, ${data.absent} marked absent, ${data.currentlyWorking} currently checked in.`);
          break;
        case 'hrm_get_attendance_report':
          lines.push(`Attendance Analysis (${data.period}): Total working records: ${data.totalRecords}. Present: ${data.presentCount}, Late marks: ${data.lateCount}, Half-days: ${data.halfDayCount}, Absences: ${data.absentCount}. Punctuality rate: ${data.punctualityRate}.`);
          break;
        case 'hrm_get_leave_requests': {
          const requests = Array.isArray(data.requests) ? data.requests : [];
          lines.push(`Found ${Number(data.totalReturned) || 0} matching leave request(s).`);
          for (const request of requests) lines.push(`#${request.id} ${request.employee} — ${request.type}, ${request.status}, ${request.from} to ${request.to} (${request.days} day(s)).`);
          break;
        }
        case 'hrm_get_payroll_summary': {
          lines.push(`Payroll Summary: ${data.totalRuns} payroll run(s) found. Total Gross: ₹${(data.totalGross || 0).toLocaleString('en-IN')}, Total Deductions: ₹${(data.totalDeductions || 0).toLocaleString('en-IN')}, Total Net Payout: ₹${(data.totalNet || 0).toLocaleString('en-IN')}.`);
          if (Array.isArray(data.recentRuns) && data.recentRuns.length) {
            for (const r of data.recentRuns) lines.push(`• Month ${r.month}/${r.year}: Net ₹${r.netSalary.toLocaleString('en-IN')} across ${r.totalEmployees} employee(s) [Status: ${r.status}]`);
          }
          break;
        }
        case 'hrm_get_loans_and_claims': {
          lines.push(`Employee Finance: Loans: ${data.totalLoans} loan(s) totaling ₹${(data.totalLoanAmount || 0).toLocaleString('en-IN')} (Pending: ₹${(data.pendingLoanAmount || 0).toLocaleString('en-IN')}). Claims: ${data.totalClaims} claim(s) totaling ₹${(data.totalClaimAmount || 0).toLocaleString('en-IN')} (Pending: ₹${(data.pendingClaimAmount || 0).toLocaleString('en-IN')}).`);
          break;
        }
        case 'tasks_search': {
          const tasks = Array.isArray(data.tasks) ? data.tasks : [];
          lines.push(`Found ${Number(data.totalCount) || 0} matching task(s).`);
          for (const task of tasks) lines.push(`#${task.id} ${task.title} — ${task.status}, ${task.priority}, due ${task.dueDate}, assigned to ${task.assignee}.`);
          break;
        }
        case 'tasks_propose_create':
        case 'tasks_propose_update_status':
        case 'crm_propose_assign_leads':
        case 'crm_propose_update_lead_status':
        case 'crm_propose_create_follow_up':
        case 'hrm_propose_update_leave_status':
          lines.push(String(data.confirmationPrompt || data.description || 'A confirmation is required before this change.'));
          break;
        case 'projects_search': {
          const works = Array.isArray(data.works) ? data.works : [];
          lines.push(`Found ${Number(data.totalCount) || 0} production/client project(s).`);
          for (const w of works) lines.push(`• #${w.id} "${w.title}" (${w.workType}) — status: ${w.status}, priority: ${w.priority}, assigned to: ${w.assignedTo}`);
          break;
        }
        case 'data_capture_stats':
          lines.push(`Data Capture: ${data.totalCaptureJobs} job(s), ${data.totalPlacesCaptured} captured place(s).`);
          break;
        case 'communications_summary': {
          lines.push(`Communications Summary: WhatsApp Campaigns: ${data.totalCampaigns} campaign(s), ${data.totalRecipients} total recipients, ${data.sentCount} sent (${data.deliveryRate} delivery rate). Active Announcements: ${data.totalAnnouncements}.`);
          break;
        }
        case 'reports_get_catalog_and_stats': {
          lines.push(`Reports & API Quotas: Available report categories: ${data.categories.join(', ')}. Google Maps Monthly Quota: ${data.googleMaps.usedQuota} used of ${data.googleMaps.monthlyQuota} (${data.googleMaps.remainingQuota} remaining).`);
          break;
        }
        case 'dashboard_kpi_summary':
          lines.push(`Business summary for your permitted scope: ${data.crm.totalLeads} lead(s), ${data.operations.openTasks} open task(s), ${data.operations.capturedPlaces} captured place(s).`);
          if (data.hrm.activeStaff !== undefined) lines.push(`HRM: ${data.hrm.presentToday} present of ${data.hrm.activeStaff} active staff (${data.hrm.attendanceRate}).`);
          else if (data.hrm.ownAttendanceRecordsToday !== undefined) lines.push(`Your attendance records today: ${data.hrm.ownAttendanceRecordsToday}.`);
          break;
        case 'cross_module_intelligence': {
          lines.push(`**Cross-Module Intelligence (${data.queryType}):**`);
          lines.push(data.summary);
          if (Array.isArray(data.details) && data.details.length) {
            for (const item of data.details) lines.push(`• ${item}`);
          }
          break;
        }
        default:
          lines.push('The requested tool returned verified data, but this result type does not have a safe answer formatter yet.');
      }
    }
    return lines.join('\n');
  }

  private async executeTool(
    name: string,
    args: any,
    user: any,
    customerId: number,
    userId: number,
    session: SessionMemory,
  ): Promise<any> {
    const isAdmin = isUserAdmin(user);
    const readPermissions: Record<string, Array<[string, string]>> = {
      crm_search_leads: [['LEADS', 'VIEW']],
      crm_get_lead_details: [['LEADS', 'VIEW']],
      crm_pipeline_summary: [['LEADS', 'VIEW']],
      crm_search_customers: [['CUSTOMERS', 'VIEW']],
      crm_get_deals_summary: [['DEALS', 'VIEW']],
      crm_get_follow_ups: [['LEADS', 'VIEW']],
      crm_get_commissions_summary: [['COMMISSION', 'VIEW']],
      crm_propose_assign_leads: [['LEADS', 'VIEW'], ['LEADS', 'EDIT']],
      crm_propose_update_lead_status: [['LEADS', 'VIEW'], ['LEADS', 'CHANGE_STAGE']],
      crm_propose_create_follow_up: [['LEADS', 'VIEW'], ['LEADS', 'EDIT']],
      hrm_search_employees: [['PROFILE', 'VIEW']],
      hrm_get_employee_details: [['PROFILE', 'VIEW']],
      hrm_get_attendance_today: [['ATTENDANCE', 'VIEW']],
      hrm_get_attendance_report: [['ATTENDANCE', 'VIEW']],
      hrm_get_leave_requests: [['LEAVE', 'VIEW']],
      hrm_get_payroll_summary: [['PAYROLL', 'VIEW']],
      hrm_get_loans_and_claims: [['LOANS', 'VIEW']],
      hrm_propose_update_leave_status: [['LEAVE', 'EDIT']],
      tasks_search: [['TASKS', 'VIEW']],
      tasks_propose_create: [['TASKS', 'CREATE']],
      tasks_propose_update_status: [['TASKS', 'EDIT']],
      projects_search: [['WORK', 'VIEW']],
      data_capture_stats: [['DATA_CAPTURE', 'VIEW']],
      communications_summary: [['WHATSAPP', 'VIEW']],
      reports_get_catalog_and_stats: [['REPORTS', 'VIEW']],
      dashboard_kpi_summary: [['DASHBOARD', 'VIEW']],
      cross_module_intelligence: [['LEADS', 'VIEW'], ['ATTENDANCE', 'VIEW']],
    };
    for (const [module, action] of readPermissions[name] || []) this.requirePermission(user, module, action);
    const accessScope = isAdmin ? {} : { assignedToId: userId };

    switch (name) {
      case 'crm_search_leads': {
        this.requirePermission(user, 'LEADS', 'VIEW');
        const { status, priority, query, limit = 5, offset = 0, onlyUnassigned, source, missingPhone, createdAfter, createdBefore, sortBy, sortOrder } = args || {};
        const validStatuses = ['NEW', 'CONTACTED', 'CALL_BACK', 'DETAILS_SENT', 'FOLLOW_UP', 'VISIT_SCHEDULED', 'VISIT_DONE', 'PROPOSAL_SENT', 'NEGOTIATION', 'FINAL_CALL', 'WON', 'LOST', 'VISIT', 'QUALIFIED', 'PROPOSAL', 'PAYMENT', 'WORK_STARTED', 'CANCELLED', 'CONVERTED'];
        if (status && !['PENDING', 'ALL', ...validStatuses].includes(String(status).toUpperCase())) return { error: `Unsupported lead status filter: ${String(status).slice(0, 40)}.` };
        const createdAfterDate = this.parseOptionalDate(createdAfter, 'createdAfter');
        const createdBeforeDate = this.parseOptionalDate(createdBefore, 'createdBefore');
        
        let statusFilter: any = { notIn: ['WON', 'LOST', 'CANCELLED', 'CONVERTED'] };
        if (status && status.toUpperCase() !== 'PENDING' && status.toUpperCase() !== 'ALL') {
          statusFilter = status.toUpperCase();
        }

        const where: any = {
          customerId,
          deletedAt: null,
          status: statusFilter,
          ...accessScope,
        };

        if (onlyUnassigned) {
          where.assignedToId = null;
          where.employeeId = null;
        }

        if (priority) {
          if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(priority).toUpperCase())) where.priority = String(priority).toUpperCase();
        }

        if (source) where.source = { equals: String(source).slice(0, 80), mode: 'insensitive' };
        if (missingPhone) where.AND = [...(where.AND || []), { OR: [{ phone: null }, { phone: '' }] }];
        if (createdAfterDate || createdBeforeDate) {
          const dateFilter: any = {};
          if (createdAfterDate) dateFilter.gte = createdAfterDate;
          if (createdBeforeDate) dateFilter.lt = createdBeforeDate;
          if (Object.keys(dateFilter).length) where.createdAt = dateFilter;
        }

        if (query) {
          const searchQuery = String(query).trim().slice(0, 120);
          const search = [
            { firstName: { contains: searchQuery, mode: 'insensitive' } },
            { lastName: { contains: searchQuery, mode: 'insensitive' } },
            { companyName: { contains: searchQuery, mode: 'insensitive' } },
            { title: { contains: searchQuery, mode: 'insensitive' } },
            { phone: { contains: searchQuery, mode: 'insensitive' } },
            { email: { contains: searchQuery, mode: 'insensitive' } },
          ];
          if (where.AND) where.AND.push({ OR: search });
          else where.OR = search;
        }

        const [totalCount, leads] = await Promise.all([
          this.prisma.lead.count({ where }),
          this.prisma.lead.findMany({
            where,
            take: Math.max(1, Math.min(Number(limit) || 5, 20)),
            skip: Math.max(0, Math.min(Number(offset) || 0, 500)),
            orderBy: { [(['createdAt', 'value', 'priority'].includes(sortBy) ? sortBy : 'createdAt')]: sortOrder === 'asc' ? 'asc' : 'desc' },
            select: {
              id: true,
              title: true,
              firstName: true,
              lastName: true,
              companyName: true,
              phone: true,
              email: true,
              status: true,
              priority: true,
              value: true,
              city: true,
              assignedTo: { select: { id: true, firstName: true, lastName: true } },
              employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
            },
          }),
        ]);

        const leadIds = leads.map((l) => l.id);
        session.lastLeadIds = leadIds;

        return {
          totalCount,
          returnedCount: leads.length,
          leads: leads.map((l) => ({
            id: l.id,
            name: [l.firstName, l.lastName].filter(Boolean).join(' ').trim() || l.companyName || l.title || `Lead #${l.id}`,
            company: l.companyName,
            phone: l.phone,
            email: l.email,
            status: l.status,
            priority: l.priority,
            value: l.value ? `₹${Number(l.value).toLocaleString('en-IN')}` : '₹0',
            assignedTo: l.employee ? `${l.employee.firstName} ${l.employee.lastName} (${l.employee.employeeCode})` : (l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : 'Unassigned'),
          })),
        };
      }

      case 'crm_get_lead_details': {
        this.requirePermission(user, 'LEADS', 'VIEW');
        const leadId = Number(args?.leadId);
        if (!leadId) return { error: 'Invalid lead ID' };

        const lead = await this.prisma.lead.findFirst({
          where: { id: leadId, customerId, deletedAt: null, ...accessScope },
          include: {
            assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
            stage: { select: { id: true, name: true } },
            notes: { take: 3, orderBy: { createdAt: 'desc' }, select: { content: true, createdAt: true } },
            timeline: { take: 5, orderBy: { createdAt: 'desc' }, select: { action: true, description: true, createdAt: true } },
          },
        });

        if (!lead) return { error: `Lead #${leadId} not found or access restricted.` };

        return {
          id: lead.id,
          name: [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || lead.companyName || lead.title,
          company: lead.companyName,
          phone: lead.phone,
          email: lead.email,
          city: lead.city,
          status: lead.status,
          stage: lead.stage?.name || 'Default',
          priority: lead.priority,
          value: lead.value ? `₹${Number(lead.value).toLocaleString('en-IN')}` : '₹0',
          assignee: lead.employee ? `${lead.employee.firstName} ${lead.employee.lastName}` : (lead.assignedTo ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}` : 'Unassigned'),
          recentNotes: lead.notes.map((n) => n.content),
          recentTimeline: lead.timeline.map((t) => `${t.action}: ${t.description}`),
        };
      }

      case 'crm_pipeline_summary': {
        this.requirePermission(user, 'LEADS', 'VIEW');
        const leads = await this.prisma.lead.findMany({
          where: { customerId, deletedAt: null, ...accessScope, ...(!isAdmin ? { assignedToId: userId } : {}) },
          select: { status: true, value: true },
        });

        const statusCounts: Record<string, number> = {};
        let totalValue = 0;
        let wonValue = 0;

        leads.forEach((l) => {
          statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
          const val = Number(l.value) || 0;
          totalValue += val;
          if (l.status === 'WON' || l.status === 'CONVERTED') {
            wonValue += val;
          }
        });

        return {
          totalLeads: leads.length,
          statusBreakdown: statusCounts,
          totalPipelineValue: `₹${totalValue.toLocaleString('en-IN')}`,
          wonValue: `₹${wonValue.toLocaleString('en-IN')}`,
        };
      }

      case 'crm_propose_assign_leads': {
        this.requirePermission(user, 'LEADS', 'EDIT');
        if (!isAdmin && !this.canViewEmployeeDirectory(user)) throw new ForbiddenException('You need employee directory access to choose a lead assignee.');
        const { employeeNameOrId, count = 5, leadIds } = args || {};
        if (!employeeNameOrId) return { error: 'Staff name or ID is required.' };

        // 1. Find employee
        const empQuery = String(employeeNameOrId).trim();
        const empNum = Number(empQuery);
        let employee = null;

        if (!isNaN(empNum) && empNum > 0) {
          employee = await this.prisma.employee.findFirst({
            where: { id: empNum, customerId, status: 'ACTIVE' },
            select: { id: true, userId: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
          });
        }

        if (!employee) {
          employee = await this.prisma.employee.findFirst({
            where: {
              customerId,
              status: 'ACTIVE',
              OR: [
                { firstName: { contains: empQuery, mode: 'insensitive' } },
                { lastName: { contains: empQuery, mode: 'insensitive' } },
                { employeeCode: { contains: empQuery, mode: 'insensitive' } },
              ],
            },
            select: { id: true, userId: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
          });
        }

        if (!isAdmin && !this.hasPermission(user, 'LEADS', 'EDIT')) throw new ForbiddenException('You cannot assign leads with your current permissions.');

        if (!employee) {
          return { error: `Active staff member "${empQuery}" not found. Please verify the employee name.` };
        }

        const matchingEmployees = Number.isInteger(empNum) && empNum > 0
          ? [employee]
          : await this.prisma.employee.findMany({
          where: {
            customerId,
            status: 'ACTIVE',
            ...(Number.isInteger(empNum) && empNum > 0 ? { id: empNum } : { OR: [
              { firstName: { contains: empQuery, mode: 'insensitive' } },
              { lastName: { contains: empQuery, mode: 'insensitive' } },
              { employeeCode: { contains: empQuery, mode: 'insensitive' } },
            ] }),
          },
          take: 2,
          select: { id: true, firstName: true, lastName: true },
        });
        if (matchingEmployees.length > 1) {
          return { error: `More than one active employee matches "${empQuery}". Please provide an employee code or full name.` };
        }
        const employeeFullName = `${employee.firstName} ${employee.lastName}`.trim();
        session.lastEmployeeId = employee.id;
        session.lastEmployeeName = employeeFullName;

        // 2. Identify target leads
        let targetLeadIds: number[] = [];
        if (Array.isArray(leadIds) && leadIds.length > 0) {
          targetLeadIds = [...new Set(leadIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
        } else if (session.lastLeadIds && session.lastLeadIds.length > 0) {
          const requested = Math.max(1, Math.min(Number(count) || 5, 20));
          if (session.lastLeadIds.length < requested) return { error: `Only ${session.lastLeadIds.length} records are in the previous result. Please run a fresh search or specify a smaller number.` };
          if (!isAdmin && session.lastLeadIds.length > 0) {
            const visible = await this.prisma.lead.count({ where: { customerId, deletedAt: null, id: { in: session.lastLeadIds }, assignedToId: userId } });
            if (visible !== session.lastLeadIds.length) return { error: 'The previous lead result changed or is no longer accessible. Please search again.' };
          }
          targetLeadIds = session.lastLeadIds.slice(0, requested);
        } else {
          // Fetch pending leads
          const openLeads = await this.prisma.lead.findMany({
            where: {
              customerId,
              deletedAt: null,
              status: { notIn: ['WON', 'LOST', 'CANCELLED', 'CONVERTED'] },
              ...(isAdmin ? { assignedToId: null } : { assignedToId: userId }),
            },
            take: Math.max(1, Math.min(Number(count) || 5, 20)),
            select: { id: true },
            orderBy: { createdAt: 'desc' },
          });
          targetLeadIds = openLeads.map((l) => l.id);
        }

        if (targetLeadIds.length > 20) return { error: 'A maximum of 20 leads can be included in one confirmed assignment.' };

        if (targetLeadIds.length === 0) {
          return { error: 'No eligible pending or unassigned leads found to assign.' };
        }

        // 3. Create Pending Action Proposal
        const proposalId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const proposal: PendingActionProposal = {
          id: proposalId,
          type: 'ASSIGN_LEADS',
          title: `Assign ${targetLeadIds.length} Leads`,
          description: `Assign ${targetLeadIds.length} lead(s) to ${employeeFullName} (${employee.employeeCode}${employee.department?.name ? ` - ${employee.department.name}` : ''})`,
          payload: {
            leadIds: targetLeadIds,
            employeeId: employee.id,
            userId: employee.userId || null,
            employeeName: employeeFullName,
          },
          summary: {
            'Target Leads': `${targetLeadIds.length} lead(s) [#${targetLeadIds.join(', #')}]`,
            'Assignee': `${employeeFullName} (${employee.employeeCode})`,
            'Department': employee.department?.name || 'General',
          },
          createdAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000,
        };

        session.pendingAction = proposal;

        return {
          requiresConfirmation: true,
          proposalId: proposal.id,
          title: proposal.title,
          description: proposal.description,
          details: proposal.summary,
          confirmationPrompt: `Found ${targetLeadIds.length} eligible lead(s). Ready to assign them to ${employeeFullName}. Would you like me to proceed with this assignment?`,
        };
      }

      case 'crm_propose_update_lead_status': {
        this.requirePermission(user, 'LEADS', 'CHANGE_STAGE');
        const { leadId, status } = args || {};
        const id = Number(leadId);
        if (!id || !status) return { error: 'Lead ID and target status are required.' };

        const lead = await this.prisma.lead.findFirst({
          where: { id, customerId, deletedAt: null, ...accessScope },
          select: { id: true, title: true, firstName: true, lastName: true, companyName: true, status: true },
        });

        if (!lead) return { error: `Lead #${id} not found.` };

        const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || lead.companyName || lead.title || `#${id}`;
        const targetStatus = status.toUpperCase().trim();
        const allowedStatuses = ['NEW', 'CONTACTED', 'CALL_BACK', 'DETAILS_SENT', 'FOLLOW_UP', 'VISIT_SCHEDULED', 'VISIT_DONE', 'PROPOSAL_SENT', 'NEGOTIATION', 'FINAL_CALL', 'WON', 'LOST', 'CANCELLED'];
        if (!allowedStatuses.includes(targetStatus)) return { error: 'That lead status is not supported.' };

        const proposalId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const proposal: PendingActionProposal = {
          id: proposalId,
          type: 'UPDATE_LEAD_STATUS',
          title: `Update Lead Status`,
          description: `Update Lead #${id} (${leadName}) status from "${lead.status}" to "${targetStatus}"`,
          payload: { leadId: id, status: targetStatus, oldStatus: lead.status, leadName },
          summary: {
            'Lead': `${leadName} (#${id})`,
            'Current Status': lead.status,
            'New Status': targetStatus,
          },
          createdAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000,
        };

        session.pendingAction = proposal;

        return {
          requiresConfirmation: true,
          proposalId: proposal.id,
          title: proposal.title,
          description: proposal.description,
          confirmationPrompt: `Ready to change status of Lead #${id} (${leadName}) to "${targetStatus}". Confirm to apply?`,
        };
      }

      case 'hrm_search_employees': {
        if (!isAdmin && !this.canViewEmployeeDirectory(user)) this.requirePermission(user, 'PROFILE', 'VIEW');
        const { query, department, limit = 5 } = args || {};
        const canViewDirectory = this.canViewEmployeeDirectory(user);
        const where: any = { customerId, status: 'ACTIVE' };
        const canSearchDirectory = canViewDirectory;
        if (!canSearchDirectory) {
          const ownEmployee = await this.prisma.employee.findFirst({ where: { customerId, userId }, select: { id: true } });
          if (!ownEmployee) return { totalCount: 0, returnedCount: 0, employees: [] };
          where.id = ownEmployee.id;
        }

        if (query && canSearchDirectory) {
          where.OR = [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { employeeCode: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ];
        }

        if (department && canSearchDirectory) {
          where.department = { name: { contains: department, mode: 'insensitive' } };
        }

        const [totalCount, employees] = await Promise.all([
          this.prisma.employee.count({ where }),
          this.prisma.employee.findMany({
            where,
            take: Math.min(limit, 20),
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              ...(isAdmin || canViewDirectory ? { email: true, phone: true } : {}),
              department: { select: { name: true } },
              designation: { select: { name: true } },
            },
          }),
        ]);

        return {
          totalCount,
          returnedCount: employees.length,
          employees: employees.map((e) => ({
            id: e.id,
            name: `${e.firstName} ${e.lastName}`.trim(),
            code: e.employeeCode,
            email: e.email,
            phone: e.phone || '—',
            department: e.department?.name || 'General',
            designation: e.designation?.name || 'Staff',
          })),
        };
      }

      case 'hrm_get_attendance_today': {
        this.requirePermission(user, 'ATTENDANCE', 'VIEW');
        const now = new Date();
        const { start: startOfDay, end: endOfDay } = getBusinessDayRange(now, BUSINESS_TIMEZONE);
        const canViewDirectory = isAdmin || this.canViewEmployeeDirectory(user);
        if (!isAdmin && !canViewDirectory) this.requirePermission(user, 'PROFILE', 'VIEW');
        if (!canViewDirectory) {
          const employee = await this.prisma.employee.findFirst({ where: { customerId, userId }, select: { id: true } });
          if (!employee) return { totalStaff: 0, present: 0, late: 0, absent: 0, currentlyWorking: 0, recentPunches: [] };
          const attendance = await this.prisma.attendance.findMany({
            where: { customerId, employeeId: employee.id, date: { gte: startOfDay, lte: endOfDay } },
            include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
          });
          const attendanceRecord = attendance[0];
          const present = Boolean(attendanceRecord?.punchIn);
          return { asOf: formatTimeInTimezone(now, BUSINESS_TIMEZONE), present: present ? 1 : 0, late: attendanceRecord?.isLate ? 1 : 0, absent: attendanceRecord?.status === 'ABSENT' ? 1 : 0, currentlyWorking: attendanceRecord?.punchIn && !attendanceRecord?.punchOut ? 1 : 0, recentPunches: [] };
        }

        const [totalEmployees, attendances] = await Promise.all([
          canViewDirectory ? this.prisma.employee.count({ where: { customerId, status: 'ACTIVE' } }) : Promise.resolve(1),
          this.prisma.attendance.findMany({
            where: {
              customerId,
              date: { gte: startOfDay, lte: endOfDay },
              employee: { customerId, status: 'ACTIVE' },
            },
            include: {
              employee: { select: { firstName: true, lastName: true, employeeCode: true } },
            },
          }),
        ]);

        const attendanceByEmployee = new Map<number, (typeof attendances)[number]>();
        for (const attendance of attendances) attendanceByEmployee.set(attendance.employeeId, attendance);
        const uniqueAttendance = [...attendanceByEmployee.values()];
        const presentCount = uniqueAttendance.filter((a) => Boolean(a.punchIn) && a.status !== 'ABSENT').length;
        const lateCount = uniqueAttendance.filter((a) => Boolean(a.isLate) || a.status === 'LATE').length;
        const absentCount = uniqueAttendance.filter((a) => a.status === 'ABSENT').length;
        const checkedInNow = uniqueAttendance.filter((a) => a.punchIn && !a.punchOut).length;

        return {
          asOf: formatTimeInTimezone(now, BUSINESS_TIMEZONE),
          ...(canViewDirectory ? { totalStaff: totalEmployees } : {}),
          present: presentCount,
          late: lateCount,
          absent: absentCount,
          currentlyWorking: checkedInNow,
          recentPunches: canViewDirectory ? uniqueAttendance.filter((a) => a.punchIn).slice(0, 5).map((a) => ({
            employee: `${a.employee.firstName} ${a.employee.lastName}`,
            code: a.employee.employeeCode,
            punchIn: a.punchIn ? formatTimeInTimezone(a.punchIn, BUSINESS_TIMEZONE) : '—',
            isLate: Boolean(a.isLate),
          })) : [],
        };
      }

      case 'hrm_get_leave_requests': {
        this.requirePermission(user, 'LEAVE', 'VIEW');
        const { status = 'PENDING', limit = 5 } = args || {};
        const where: any = { customerId };
        const canViewAllLeave = isAdmin || this.hasPermission(user, 'LEAVE', 'APPROVE') || this.hasPermission(user, 'LEAVE', 'REJECT');
        if (!canViewAllLeave) {
          const employee = await this.prisma.employee.findFirst({ where: { customerId, userId }, select: { id: true } });
          if (!employee) return { totalReturned: 0, requests: [] };
          where.employeeId = employee.id;
        }
        if (status && status.toUpperCase() !== 'ALL') {
          where.status = status.toUpperCase();
        }

        const leaves = await this.prisma.leaveRequest.findMany({
          where,
          take: Math.min(limit, 20),
          orderBy: { createdAt: 'desc' },
          include: {
            employee: { select: { firstName: true, lastName: true, employeeCode: true } },
            leaveType: { select: { name: true } },
          },
        });

        return {
          totalReturned: leaves.length,
          requests: leaves.map((l) => ({
            id: l.id,
            employee: `${l.employee.firstName} ${l.employee.lastName} (${l.employee.employeeCode})`,
            type: l.leaveType?.name || 'General Leave',
            from: l.fromDate ? getBusinessDayRange(l.fromDate, BUSINESS_TIMEZONE).dateStr : '—',
            to: l.toDate ? getBusinessDayRange(l.toDate, BUSINESS_TIMEZONE).dateStr : '—',
            days: l.days,
            reason: l.reason || 'None specified',
            status: l.status,
          })),
        };
      }

      case 'tasks_search': {
        this.requirePermission(user, 'TASKS', 'VIEW');
        const { status, priority, query, limit = 5, offset = 0, assignedTo, overdue, dueAfter, dueBefore, sortBy, sortOrder } = args || {};
        const validStatuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED', 'BLOCKED'];
        if (status && String(status).toUpperCase() !== 'ALL' && !validStatuses.includes(String(status).toUpperCase())) return { error: `Unsupported task status filter: ${String(status).slice(0, 40)}.` };
        const dueAfterDate = this.parseOptionalDate(dueAfter, 'dueAfter');
        const dueBeforeDate = this.parseOptionalDate(dueBefore, 'dueBefore');
        const where: any = { customerId, deletedAt: null };

        if (!isAdmin) {
          const ownEmployee = await this.prisma.employee.findFirst({ where: { customerId, userId }, select: { id: true } });
          where.OR = [
            { assignedToId: userId },
            ...(ownEmployee ? [{ employeeId: ownEmployee.id }] : []),
          ];
        }

        if (status && status.toUpperCase() !== 'ALL') {
          if (validStatuses.includes(String(status).toUpperCase())) where.status = String(status).toUpperCase();
        }

        if (priority) {
          if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(priority).toUpperCase())) where.priority = String(priority).toUpperCase();
        }

        if (assignedTo) {
          const assignee = await this.prisma.employee.findFirst({
            where: {
              customerId,
              status: 'ACTIVE',
              ...(Number.isInteger(Number(assignedTo)) ? { id: Number(assignedTo) } : { OR: [
                { firstName: { contains: String(assignedTo).slice(0, 80), mode: 'insensitive' } },
                { lastName: { contains: String(assignedTo).slice(0, 80), mode: 'insensitive' } },
              ] }),
            },
            select: { id: true },
          });
          if (!assignee) return { totalCount: 0, tasks: [], message: 'No active matching assignee was found.' };
          where.employeeId = assignee.id;
        }

        if (overdue) {
          where.AND = [...(where.AND || []), { OR: [{ dueDate: { lt: new Date() } }, { dueAt: { lt: new Date() } }] }];
          where.status = { notIn: ['COMPLETED', 'CANCELLED'] };
        } else if (dueAfterDate || dueBeforeDate) {
          const dateFilter: any = {};
          if (dueAfterDate) dateFilter.gte = dueAfterDate;
          if (dueBeforeDate) dateFilter.lt = dueBeforeDate;
          if (Object.keys(dateFilter).length) where.AND = [...(where.AND || []), { OR: [{ dueDate: dateFilter }, { dueAt: dateFilter }] }];
        }

        if (query) {
          const searchQuery = String(query).trim().slice(0, 120);
          const search = [
            { title: { contains: searchQuery, mode: 'insensitive' } },
            { description: { contains: searchQuery, mode: 'insensitive' } },
          ];
          if (where.OR) where.AND = [{ OR: where.OR }, { OR: search }];
          else where.OR = search;
        }

        const [totalCount, tasks] = await Promise.all([this.prisma.task.count({ where }), this.prisma.task.findMany({
          where,
          take: Math.max(1, Math.min(Number(limit) || 5, 20)),
          skip: Math.max(0, Math.min(Number(offset) || 0, 500)),
          orderBy: { [(['createdAt', 'dueDate', 'priority'].includes(sortBy) ? sortBy : 'createdAt')]: sortOrder === 'asc' ? 'asc' : 'desc' },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            dueAt: true,
            assignedTo: { select: { firstName: true, lastName: true } },
            employee: { select: { firstName: true, lastName: true, employeeCode: true } },
          },
        })]);

        return {
          totalCount,
          returnedCount: tasks.length,
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            dueDate: t.dueDate || t.dueAt ? getBusinessDayRange(t.dueDate || t.dueAt, BUSINESS_TIMEZONE).dateStr : 'None',
            assignee: t.employee ? `${t.employee.firstName} ${t.employee.lastName}` : (t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : 'Unassigned'),
          })),
        };
      }

      case 'tasks_propose_create': {
        this.requirePermission(user, 'TASKS', 'CREATE');
        if (args?.assigneeNameOrId && !isAdmin && !this.canViewEmployeeDirectory(user)) throw new ForbiddenException('You need employee directory access to choose a task assignee.');
        const { title, description, priority = 'MEDIUM', dueDate, assigneeNameOrId } = args || {};
        if (!title) return { error: 'Task title is required.' };

        let employee = null;
        if (assigneeNameOrId) {
          const empQuery = String(assigneeNameOrId).trim();
          const matches = await this.prisma.employee.findMany({
            where: {
              customerId,
              status: 'ACTIVE',
              ...(Number.isInteger(Number(empQuery)) ? { id: Number(empQuery) } : { OR: [
                { firstName: { contains: empQuery, mode: 'insensitive' } },
                { lastName: { contains: empQuery, mode: 'insensitive' } },
              ] }),
            },
            take: 2,
            select: { id: true, userId: true, firstName: true, lastName: true, employeeCode: true },
          });
          if (matches.length > 1) return { error: `More than one active employee matches "${empQuery}". Please provide a full name or employee ID.` };
          employee = matches[0] || null;
          if (!employee) return { error: `Active employee "${empQuery}" was not found.` };
        }

        const assigneeFullName = employee ? `${employee.firstName} ${employee.lastName}` : null;
        const proposalId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const normalizedTitle = String(title).trim();
        const normalizedPriority = String(priority).toUpperCase();
        if (!normalizedTitle || normalizedTitle.length > 180) return { error: 'Task title must be between 1 and 180 characters.' };
        if (!['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(normalizedPriority)) return { error: 'Task priority is invalid.' };
        if (dueDate && !Number.isFinite(new Date(dueDate).getTime())) return { error: 'Task due date is invalid.' };
        const proposal: PendingActionProposal = {
          id: proposalId,
          type: 'CREATE_TASK',
          title: `Create Task: "${normalizedTitle}"`,
          description: `Create new task with priority ${normalizedPriority}${assigneeFullName ? ` assigned to ${assigneeFullName}` : ''}`,
          payload: {
            title: normalizedTitle,
            description,
            priority: normalizedPriority,
            dueDate,
            employeeId: employee?.id || null,
            assigneeUserId: employee?.userId || null,
            assigneeName: assigneeFullName,
          },
          summary: {
            'Title': normalizedTitle,
            'Priority': normalizedPriority,
            'Due Date': dueDate || 'Not set',
            'Assignee': assigneeFullName || 'Unassigned',
          },
          createdAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000,
        };

        session.pendingAction = proposal;

        return {
          requiresConfirmation: true,
          proposalId: proposal.id,
          title: proposal.title,
          description: proposal.description,
          confirmationPrompt: `Ready to create task "${normalizedTitle}"${assigneeFullName ? ` for ${assigneeFullName}` : ''}. Would you like me to proceed?`,
        };
      }

      case 'data_capture_stats': {
        this.requirePermission(user, 'DATA_CAPTURE', 'VIEW');
        const jobScope: any = { customerId, ...(isAdmin ? {} : { userId }) };
        const placeScope: any = { customerId, ...(isAdmin ? {} : { job: { userId } }) };
        const [totalJobs, totalPlaces, recentJobs] = await Promise.all([
          this.prisma.dataCaptureJob.count({ where: jobScope }),
          this.prisma.dataCapturePlace.count({ where: placeScope }),
          this.prisma.dataCaptureJob.findMany({
            where: jobScope,
            take: 3,
            orderBy: { createdAt: 'desc' },
            select: { jobId: true, keyword: true, location: true, capturedResults: true, createdAt: true },
          }),
        ]);

        return {
          totalCaptureJobs: totalJobs,
          totalPlacesCaptured: totalPlaces,
          recentJobs: recentJobs.map((j) => ({
            id: j.jobId,
            keyword: j.keyword,
            location: j.location,
            captured: j.capturedResults,
            date: new Date(j.createdAt).toLocaleDateString('en-IN'),
          })),
        };
      }

      case 'dashboard_kpi_summary': {
        this.requirePermission(user, 'DASHBOARD', 'VIEW');
        const now = new Date();
        const { start: startOfDay, end: endOfDay } = getBusinessDayRange(now, BUSINESS_TIMEZONE);
        const leadScope: any = { customerId, deletedAt: null, ...accessScope };
        const taskScope: any = { customerId, deletedAt: null, status: { in: ['PENDING', 'IN_PROGRESS'] } };
        if (!isAdmin) {
          const ownEmployee = await this.prisma.employee.findFirst({ where: { customerId, userId }, select: { id: true } });
          taskScope.OR = [{ assignedToId: userId }, ...(ownEmployee ? [{ employeeId: ownEmployee.id }] : [])];
        }

        const [totalLeads, todayLeads, totalStaff, presentAttendance, openTasks, totalPlaces] = await Promise.all([
          this.prisma.lead.count({ where: leadScope }),
          this.prisma.lead.count({ where: { ...leadScope, createdAt: { gte: startOfDay, lte: endOfDay } } }),
          this.prisma.employee.count({ where: isAdmin ? { customerId, status: 'ACTIVE' } : { customerId, userId, status: 'ACTIVE' } }),
          this.prisma.attendance.findMany({
            where: { customerId, date: { gte: startOfDay, lte: endOfDay }, punchIn: { not: null }, status: { in: ['PRESENT', 'LATE', 'REMOTE', 'HALF_DAY'] }, ...(!isAdmin ? { employee: { userId } } : {}) },
            select: { employeeId: true },
            distinct: ['employeeId'],
          }),
          this.prisma.task.count({ where: taskScope }),
          this.prisma.dataCapturePlace.count({ where: { customerId, ...(!isAdmin ? { job: { userId } } : {}) } }),
        ]);

        return {
          crm: { totalLeads, newLeadsToday: todayLeads },
          hrm: isAdmin ? { activeStaff: totalStaff, presentToday: presentAttendance.length, attendanceRate: totalStaff > 0 ? `${Math.round((presentAttendance.length / totalStaff) * 100)}%` : '0%' } : { ownAttendanceRecordsToday: presentAttendance.length },
          operations: { openTasks, capturedPlaces: totalPlaces },
        };
      }

      case 'crm_search_customers': {
        this.requirePermission(user, 'CUSTOMERS', 'VIEW');
        const { query, status, limit = 5 } = args || {};
        const where: any = { deletedAt: null };
        if (query) {
          const q = String(query).trim().slice(0, 100);
          where.OR = [
            { name: { contains: q, mode: 'insensitive' } },
            { companyName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
          ];
        }
        if (status && status.toUpperCase() === 'ACTIVE') where.isActive = true;
        else if (status && status.toUpperCase() === 'INACTIVE') where.isActive = false;

        const [totalCustomers, customers] = await Promise.all([
          this.prisma.customer.count({ where }),
          this.prisma.customer.findMany({
            where,
            select: {
              id: true,
              name: true,
              companyName: true,
              phone: true,
              email: true,
              city: true,
              customerType: true,
              assignedEmployee: true,
              isActive: true,
            },
            take: Math.min(Math.max(1, Number(limit) || 5), 20),
            orderBy: { id: 'desc' },
          }),
        ]);

        return {
          totalCustomers,
          customers: customers.map((c) => ({
            id: c.id,
            name: c.name,
            companyName: c.companyName,
            phone: c.phone,
            email: c.email,
            status: c.isActive ? 'Active' : 'Inactive',
            assignedEmployee: c.assignedEmployee,
          })),
        };
      }

      case 'crm_get_deals_summary': {
        this.requirePermission(user, 'DEALS', 'VIEW');
        const { limit = 5 } = args || {};
        const where: any = { customerId, deletedAt: null, ...accessScope };
        const deals = await this.prisma.deal.findMany({
          where,
          include: {
            stage: { select: { name: true } },
            assignedTo: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        let totalValue = 0;
        let wonValue = 0;
        let wonCount = 0;
        let lostCount = 0;
        const stageBreakdown: Record<string, number> = {};

        for (const d of deals) {
          const val = Number(d.amount) || 0;
          if (d.isWon) {
            wonValue += val;
            wonCount++;
          } else if (d.isLost) {
            lostCount++;
          } else {
            totalValue += val;
          }
          const sName = d.stage?.name || 'Open';
          stageBreakdown[sName] = (stageBreakdown[sName] || 0) + 1;
        }

        return {
          totalDeals: deals.length,
          totalOpenDeals: deals.length - wonCount - lostCount,
          wonDealsCount: wonCount,
          lostDealsCount: lostCount,
          totalPipelineValue: `₹${totalValue.toLocaleString('en-IN')}`,
          wonValue: `₹${wonValue.toLocaleString('en-IN')}`,
          stageBreakdown,
          recentDeals: deals.slice(0, Math.min(Math.max(1, Number(limit) || 5), 10)).map((d) => ({
            id: d.id,
            title: d.title,
            amount: d.amount,
            isWon: d.isWon,
            isLost: d.isLost,
            stage: d.stage?.name || 'Open',
            assignee: d.assignedTo ? `${d.assignedTo.firstName} ${d.assignedTo.lastName}`.trim() : 'Unassigned',
          })),
        };
      }

      case 'crm_get_follow_ups': {
        this.requirePermission(user, 'LEADS', 'VIEW');
        const { timeframe = 'TODAY', limit = 5 } = args || {};
        const now = new Date();
        const { start: startOfDay, end: endOfDay } = getBusinessDayRange(now, BUSINESS_TIMEZONE);

        const reminderWhere: any = {
          lead: { customerId, deletedAt: null, ...accessScope },
        };
        if (timeframe === 'TODAY') {
          reminderWhere.remindAt = { gte: startOfDay, lte: endOfDay };
        } else if (timeframe === 'OVERDUE') {
          reminderWhere.remindAt = { lt: startOfDay };
          reminderWhere.isCompleted = false;
        } else if (timeframe === 'UPCOMING') {
          reminderWhere.remindAt = { gt: endOfDay };
          reminderWhere.isCompleted = false;
        }

        const visitWhere: any = {
          customerId,
          ...(timeframe === 'TODAY' ? { date: { gte: startOfDay, lte: endOfDay } } : {}),
          ...(!isAdmin ? { employee: { userId } } : {}),
        };

        const [reminders, visits] = await Promise.all([
          this.prisma.leadReminder.findMany({
            where: reminderWhere,
            include: { lead: { select: { id: true, firstName: true, lastName: true, companyName: true, phone: true } } },
            take: Math.min(Math.max(1, Number(limit) || 5), 15),
            orderBy: { remindAt: 'asc' },
          }),
          this.prisma.visit.findMany({
            where: visitWhere,
            take: 5,
            orderBy: { date: 'asc' },
          }),
        ]);

        return {
          timeframe,
          totalReminders: reminders.length,
          totalVisits: visits.length,
          reminders: reminders.map((r) => ({
            id: r.id,
            leadId: r.leadId,
            leadName: [r.lead.firstName, r.lead.lastName].filter(Boolean).join(' ') || r.lead.companyName || `#${r.leadId}`,
            title: r.title,
            remindAt: formatTimeInTimezone(r.remindAt, BUSINESS_TIMEZONE),
            isCompleted: r.isCompleted,
          })),
          visits: visits.map((v) => ({
            id: v.id,
            customerName: v.customerName,
            purpose: v.purpose,
            location: v.location,
            date: v.date ? v.date.toISOString().slice(0, 10) : '—',
            time: v.time || '—',
            status: v.status,
          })),
        };
      }

      case 'crm_get_commissions_summary': {
        this.requirePermission(user, 'COMMISSION', 'VIEW');
        const { employeeNameOrId } = args || {};
        const where: any = { customerId };
        if (employeeNameOrId) {
          const emp = await this.prisma.employee.findFirst({
            where: {
              customerId,
              OR: [
                ...(Number.isInteger(Number(employeeNameOrId)) ? [{ id: Number(employeeNameOrId) }] : []),
                { firstName: { contains: String(employeeNameOrId).trim(), mode: 'insensitive' } },
                { lastName: { contains: String(employeeNameOrId).trim(), mode: 'insensitive' } },
              ],
            },
            select: { id: true },
          });
          if (emp) where.employeeId = emp.id;
        }

        const commissions = await this.prisma.commission.findMany({
          where,
          include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
        });

        let totalEarned = 0;
        let approvedAmount = 0;
        let paidAmount = 0;
        let pendingAmount = 0;

        for (const c of commissions) {
          const amt = Number(c.commissionAmount) || 0;
          totalEarned += amt;
          if (c.status === 'APPROVED') approvedAmount += amt;
          else if (c.status === 'PAID') paidAmount += amt;
          else if (c.status === 'PENDING') pendingAmount += amt;
        }

        return {
          totalTransactions: commissions.length,
          totalEarned,
          approvedAmount,
          paidAmount,
          pendingAmount,
        };
      }

      case 'crm_propose_create_follow_up': {
        this.requirePermission(user, 'LEADS', 'EDIT');
        const { leadId, title, remindAt } = args || {};
        const numericLeadId = Number(leadId);
        if (!Number.isInteger(numericLeadId) || numericLeadId <= 0) {
          return { error: 'Please provide a valid numeric lead ID.' };
        }
        const lead = await this.prisma.lead.findFirst({
          where: { id: numericLeadId, customerId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, companyName: true },
        });
        if (!lead) return { error: `Lead #${numericLeadId} was not found.` };
        const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.companyName || `#${lead.id}`;
        const remindDate = new Date(remindAt);
        if (!Number.isFinite(remindDate.getTime())) {
          return { error: 'Please provide a valid ISO date for the follow-up reminder.' };
        }

        const proposalId = `prop-followup-${Date.now()}`;
        const proposal: PendingActionProposal = {
          id: proposalId,
          type: 'CREATE_FOLLOW_UP',
          title: `Schedule Follow-up for Lead #${lead.id}`,
          description: `Create a reminder "${title || 'Follow-up'}" for Lead #${lead.id} (${leadName}) on ${remindDate.toLocaleString('en-IN')}.`,
          payload: { leadId: lead.id, title: title || 'Follow up with lead', remindAt: remindDate.toISOString() },
          summary: { Lead: leadName, 'Scheduled For': remindDate.toLocaleString('en-IN'), Note: title || 'Follow up' },
          createdAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000,
        };
        session.pendingAction = proposal;

        return {
          proposalId,
          confirmationPrompt: `I have prepared a follow-up reminder for **${leadName}** on **${remindDate.toLocaleDateString('en-IN')}**. Please confirm to schedule this reminder.`,
          description: proposal.description,
          summary: proposal.summary,
        };
      }

      case 'hrm_get_employee_details': {
        this.requirePermission(user, 'PROFILE', 'VIEW');
        const { employeeNameOrId } = args || {};
        if (!employeeNameOrId) return { error: 'Please specify an employee name or ID.' };

        const emp = await this.prisma.employee.findFirst({
          where: {
            customerId,
            OR: [
              ...(Number.isInteger(Number(employeeNameOrId)) ? [{ id: Number(employeeNameOrId) }] : []),
              { firstName: { contains: String(employeeNameOrId).trim(), mode: 'insensitive' } },
              { lastName: { contains: String(employeeNameOrId).trim(), mode: 'insensitive' } },
              { employeeCode: { equals: String(employeeNameOrId).trim(), mode: 'insensitive' } },
            ],
          },
          include: {
            department: { select: { name: true } },
            designation: { select: { name: true } },
            user: { select: { email: true, phone: true } },
          },
        });

        if (!emp) return { error: `Employee "${employeeNameOrId}" was not found.` };

        return {
          id: emp.id,
          name: `${emp.firstName} ${emp.lastName}`.trim(),
          employeeCode: emp.employeeCode,
          status: emp.status,
          department: emp.department?.name,
          designation: emp.designation?.name,
          email: isAdmin ? (emp.email || emp.user?.email) : undefined,
          phone: isAdmin ? (emp.phone || emp.user?.phone) : undefined,
        };
      }

      case 'hrm_get_attendance_report': {
        this.requirePermission(user, 'ATTENDANCE', 'VIEW');
        const now = new Date();
        const month = Number(args?.month) || (now.getMonth() + 1);
        const year = Number(args?.year) || now.getFullYear();
        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

        const where: any = {
          customerId,
          date: { gte: startOfMonth, lte: endOfMonth },
          ...accessScope,
        };

        const records = await this.prisma.attendance.findMany({
          where,
          select: {
            status: true,
            isLate: true,
            punchIn: true,
          },
        });

        const presentCount = records.filter((r) => Boolean(r.punchIn) && r.status !== 'ABSENT').length;
        const lateCount = records.filter((r) => Boolean(r.isLate) || r.status === 'LATE').length;
        const halfDayCount = records.filter((r) => r.status === 'HALF_DAY').length;
        const absentCount = records.filter((r) => r.status === 'ABSENT').length;
        const punctualityRate = records.length > 0 ? `${Math.round(((presentCount - lateCount) / Math.max(1, presentCount)) * 100)}%` : '100%';

        return {
          period: `${month}/${year}`,
          totalRecords: records.length,
          presentCount,
          lateCount,
          halfDayCount,
          absentCount,
          punctualityRate,
        };
      }

      case 'hrm_get_payroll_summary': {
        this.requirePermission(user, 'PAYROLL', 'VIEW');
        const { month, year } = args || {};
        const where: any = { customerId };
        if (month) where.month = Number(month);
        if (year) where.year = Number(year);

        const payrolls = await this.prisma.payroll.findMany({
          where,
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
          take: 5,
        });

        let totalGross = 0;
        let totalDeductions = 0;
        let totalNet = 0;

        for (const p of payrolls) {
          totalGross += Number(p.grossSalary) || 0;
          totalDeductions += Number(p.totalDeductions) || 0;
          totalNet += Number(p.netSalary) || 0;
        }

        return {
          totalRuns: payrolls.length,
          totalGross,
          totalDeductions,
          totalNet,
          recentRuns: payrolls.map((p) => ({
            id: p.id,
            month: p.month,
            year: p.year,
            netSalary: p.netSalary,
            totalEmployees: p.totalEmployees,
            status: p.status,
          })),
        };
      }

      case 'hrm_get_loans_and_claims': {
        this.requirePermission(user, 'LOANS', 'VIEW');
        const { type = 'ALL', status } = args || {};
        const loanWhere: any = { customerId };
        const claimWhere: any = { customerId };
        if (status && status.toUpperCase() !== 'ALL') {
          loanWhere.status = status.toUpperCase();
          claimWhere.status = status.toUpperCase();
        }

        const [loans, claims] = await Promise.all([
          type === 'CLAIMS' ? Promise.resolve([]) : this.prisma.employeeLoan.findMany({ where: loanWhere }),
          type === 'LOANS' ? Promise.resolve([]) : this.prisma.employeeClaim.findMany({ where: claimWhere }),
        ]);

        let totalLoanAmount = 0;
        let pendingLoanAmount = 0;
        for (const l of loans) {
          totalLoanAmount += Number(l.loanAmount) || 0;
          if (l.status === 'PENDING') pendingLoanAmount += Number(l.loanAmount) || 0;
        }

        let totalClaimAmount = 0;
        let pendingClaimAmount = 0;
        for (const c of claims) {
          totalClaimAmount += Number(c.amount) || 0;
          if (c.status === 'PENDING') pendingClaimAmount += Number(c.amount) || 0;
        }

        return {
          totalLoans: loans.length,
          totalLoanAmount,
          pendingLoanAmount,
          totalClaims: claims.length,
          totalClaimAmount,
          pendingClaimAmount,
        };
      }

      case 'hrm_propose_update_leave_status': {
        this.requirePermission(user, 'LEAVE', 'EDIT');
        const { leaveId, status, reviewNote } = args || {};
        const numericLeaveId = Number(leaveId);
        if (!Number.isInteger(numericLeaveId) || numericLeaveId <= 0) {
          return { error: 'Please provide a valid leave ID.' };
        }
        if (!['APPROVED', 'REJECTED'].includes(String(status).toUpperCase())) {
          return { error: 'Status must be APPROVED or REJECTED.' };
        }
        const leave = await this.prisma.leaveRequest.findFirst({
          where: { id: numericLeaveId, customerId },
          include: { employee: { select: { firstName: true, lastName: true } } },
        });
        if (!leave) return { error: `Leave request #${numericLeaveId} was not found.` };

        const proposalId = `prop-leave-${Date.now()}`;
        const targetStatus = String(status).toUpperCase();
        const proposal: PendingActionProposal = {
          id: proposalId,
          type: 'UPDATE_LEAVE_STATUS',
          title: `${targetStatus === 'APPROVED' ? 'Approve' : 'Reject'} Leave Request #${leave.id}`,
          description: `${targetStatus === 'APPROVED' ? 'Approve' : 'Reject'} leave request #${leave.id} for ${leave.employee?.firstName || 'staff'}.`,
          payload: { leaveId: leave.id, status: targetStatus, reviewNote: reviewNote || null },
          summary: { 'Leave ID': leave.id, Employee: `${leave.employee?.firstName || 'Staff'}`, 'New Status': targetStatus },
          createdAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000,
        };
        session.pendingAction = proposal;

        return {
          proposalId,
          confirmationPrompt: `I have prepared to **${targetStatus.toLowerCase()}** leave request #${leave.id} for **${leave.employee?.firstName || 'staff'}**. Please confirm to proceed.`,
          description: proposal.description,
          summary: proposal.summary,
        };
      }

      case 'tasks_propose_update_status': {
        this.requirePermission(user, 'TASKS', 'EDIT');
        const { taskId, status } = args || {};
        const numericTaskId = Number(taskId);
        if (!Number.isInteger(numericTaskId) || numericTaskId <= 0) {
          return { error: 'Please provide a valid task ID.' };
        }
        const validStatuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
        if (!validStatuses.includes(String(status).toUpperCase())) {
          return { error: 'Status must be PENDING, IN_PROGRESS, COMPLETED, or CANCELLED.' };
        }
        const task = await this.prisma.task.findFirst({
          where: { id: numericTaskId, customerId, deletedAt: null },
          select: { id: true, title: true, status: true },
        });
        if (!task) return { error: `Task #${numericTaskId} was not found.` };

        const targetStatus = String(status).toUpperCase();
        const proposalId = `prop-taskstatus-${Date.now()}`;
        const proposal: PendingActionProposal = {
          id: proposalId,
          type: 'UPDATE_TASK_STATUS',
          title: `Update Task #${task.id} to ${targetStatus}`,
          description: `Change task "${task.title}" status from ${task.status} to ${targetStatus}.`,
          payload: { taskId: task.id, status: targetStatus, oldStatus: task.status },
          summary: { Task: task.title, 'Current Status': task.status, 'Target Status': targetStatus },
          createdAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000,
        };
        session.pendingAction = proposal;

        return {
          proposalId,
          confirmationPrompt: `I have prepared to mark Task #${task.id} ("${task.title}") as **${targetStatus}**. Please confirm to proceed.`,
          description: proposal.description,
          summary: proposal.summary,
        };
      }

      case 'projects_search': {
        this.requirePermission(user, 'WORK', 'VIEW');
        const { status, query, limit = 5 } = args || {};
        const where: any = { customerId };
        if (status) where.status = status.toUpperCase();
        if (query) where.title = { contains: String(query).trim(), mode: 'insensitive' };

        const [totalCount, works] = await Promise.all([
          this.prisma.work.count({ where }),
          this.prisma.work.findMany({
            where,
            include: { assignedTo: { select: { firstName: true, lastName: true } } },
            take: Math.min(Math.max(1, Number(limit) || 5), 15),
            orderBy: { createdAt: 'desc' },
          }),
        ]);

        return {
          totalCount,
          works: works.map((w) => ({
            id: w.id,
            title: w.title,
            workType: w.workType,
            status: w.status,
            priority: w.priority,
            assignedTo: w.assignedTo ? `${w.assignedTo.firstName} ${w.assignedTo.lastName}`.trim() : 'Unassigned',
          })),
        };
      }

      case 'communications_summary': {
        this.requirePermission(user, 'WHATSAPP', 'VIEW');
        const [campaigns, announcements] = await Promise.all([
          this.prisma.whatsAppCampaign.findMany({ where: { customerId } }),
          this.prisma.announcement.count({ where: { customerId } }),
        ]);

        let totalRecipients = 0;
        let sentCount = 0;
        let deliveredCount = 0;

        for (const c of campaigns) {
          totalRecipients += c.recipientCount || 0;
          sentCount += c.sentCount || 0;
          deliveredCount += c.deliveredCount || 0;
        }

        const deliveryRate = sentCount > 0 ? `${Math.round((deliveredCount / sentCount) * 100)}%` : '100%';

        return {
          totalCampaigns: campaigns.length,
          totalRecipients,
          sentCount,
          deliveredCount,
          deliveryRate,
          totalAnnouncements: announcements,
        };
      }

      case 'reports_get_catalog_and_stats': {
        this.requirePermission(user, 'REPORTS', 'VIEW');
        const quota = await this.prisma.googleMapsQuota.findFirst({ where: { customerId } });
        const used = quota?.monthlyLimit ? Math.min(quota.dailyLimit * 10, quota.monthlyLimit) : 0;
        return {
          categories: ['CRM Analytics', 'HRM & Attendance', 'Payroll & Compensation', 'Production & Workload', 'Financial & Invoices'],
          googleMaps: {
            monthlyQuota: quota?.monthlyLimit || 20000,
            usedQuota: used,
            remainingQuota: Math.max(0, (quota?.monthlyLimit || 20000) - used),
          },
        };
      }

      case 'cross_module_intelligence': {
        this.requirePermission(user, 'LEADS', 'VIEW');
        this.requirePermission(user, 'ATTENDANCE', 'VIEW');
        const { queryType } = args || {};

        if (queryType === 'LEADS_ON_LEAVE') {
          const now = new Date();
          const { start: startOfDay, end: endOfDay } = getBusinessDayRange(now, BUSINESS_TIMEZONE);
          const approvedLeaves = await this.prisma.leaveRequest.findMany({
            where: {
              customerId,
              status: 'APPROVED',
              fromDate: { lte: endOfDay },
              toDate: { gte: startOfDay },
            },
            include: { employee: { select: { id: true, userId: true, firstName: true, lastName: true } } },
          });

          const onLeaveEmployeeIds = approvedLeaves.map((l) => l.employeeId);
          const onLeaveUserIds = approvedLeaves.map((l) => l.employee?.userId).filter(Boolean) as number[];

          if (!onLeaveEmployeeIds.length && !onLeaveUserIds.length) {
            return {
              queryType,
              summary: 'No active staff members are currently on approved leave today.',
              details: [],
            };
          }

          const leadsOnLeave = await this.prisma.lead.findMany({
            where: {
              customerId,
              deletedAt: null,
              status: { notIn: ['WON', 'LOST', 'CANCELLED', 'CONVERTED'] },
              OR: [
                { employeeId: { in: onLeaveEmployeeIds } },
                { assignedToId: { in: onLeaveUserIds } },
              ],
            },
            select: { id: true, title: true, firstName: true, lastName: true, companyName: true, status: true, assignedTo: { select: { firstName: true, lastName: true } } },
            take: 10,
          });

          return {
            queryType,
            summary: `Found ${leadsOnLeave.length} pending lead(s) assigned to ${approvedLeaves.length} staff member(s) who are currently on leave.`,
            details: leadsOnLeave.map((l) => `Lead #${l.id} (${l.companyName || l.title || 'Lead'}): assigned to ${l.assignedTo?.firstName || 'staff on leave'} (Status: ${l.status})`),
          };
        }

        if (queryType === 'STAFF_PERFORMANCE_ATTENDANCE') {
          const employees = await this.prisma.employee.findMany({
            where: { customerId, status: 'ACTIVE' },
            select: { id: true, userId: true, firstName: true, lastName: true },
          });

          const performanceList = await Promise.all(
            employees.slice(0, 10).map(async (emp) => {
              const [totalLeads, wonLeads, attendanceDays] = await Promise.all([
                this.prisma.lead.count({ where: { customerId, deletedAt: null, OR: [{ employeeId: emp.id }, ...(emp.userId ? [{ assignedToId: emp.userId }] : [])] } }),
                this.prisma.lead.count({ where: { customerId, deletedAt: null, status: 'WON', OR: [{ employeeId: emp.id }, ...(emp.userId ? [{ assignedToId: emp.userId }] : [])] } }),
                this.prisma.attendance.count({ where: { customerId, employeeId: emp.id, punchIn: { not: null }, status: { in: ['PRESENT', 'LATE'] } } }),
              ]);
              const conversion = totalLeads > 0 ? `${Math.round((wonLeads / totalLeads) * 100)}%` : '0%';
              return {
                name: `${emp.firstName} ${emp.lastName}`.trim(),
                totalLeads,
                wonLeads,
                conversion,
                attendanceDays,
              };
            })
          );

          performanceList.sort((a, b) => b.wonLeads - a.wonLeads);

          return {
            queryType,
            summary: `Cross-module analysis of staff lead conversion vs attendance across ${performanceList.length} staff member(s):`,
            details: performanceList.map((p) => `${p.name}: ${p.wonLeads} won leads (${p.conversion} conversion) with ${p.attendanceDays} logged attendance day(s)`),
          };
        }

        if (queryType === 'OVERDUE_TASKS_AND_FOLLOWUPS') {
          const now = new Date();
          const { start: startOfDay } = getBusinessDayRange(now, BUSINESS_TIMEZONE);

          const [overdueTasks, overdueReminders] = await Promise.all([
            this.prisma.task.findMany({
              where: { customerId, deletedAt: null, dueDate: { lt: startOfDay }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
              include: { assignedTo: { select: { firstName: true, lastName: true } } },
              take: 10,
            }),
            this.prisma.leadReminder.findMany({
              where: { lead: { customerId, deletedAt: null }, remindAt: { lt: startOfDay }, isCompleted: false },
              include: { lead: { select: { id: true, firstName: true, lastName: true, companyName: true, assignedTo: { select: { firstName: true, lastName: true } } } } },
              take: 10,
            }),
          ]);

          return {
            queryType,
            summary: `Found ${overdueTasks.length} overdue task(s) and ${overdueReminders.length} overdue follow-up reminder(s).`,
            details: [
              ...overdueTasks.map((t) => `Task #${t.id} "${t.title}" (Due: ${t.dueDate ? t.dueDate.toISOString().slice(0, 10) : 'Past'}): assigned to ${t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}`.trim() : 'Unassigned'}`),
              ...overdueReminders.map((r) => `Reminder for Lead #${r.leadId} ("${r.title}"): assigned to ${r.lead.assignedTo ? `${r.lead.assignedTo.firstName} ${r.lead.assignedTo.lastName}`.trim() : 'Unassigned'}`),
            ],
          };
        }

        if (queryType === 'STAFF_TASK_AND_ATTENDANCE_ISSUES') {
          const now = new Date();
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          const employees = await this.prisma.employee.findMany({
            where: { customerId, status: 'ACTIVE' },
            select: { id: true, userId: true, firstName: true, lastName: true },
          });

          const issueList: string[] = [];
          for (const emp of employees.slice(0, 15)) {
            const [pendingTasks, lateOrAbsent] = await Promise.all([
              this.prisma.task.count({ where: { customerId, deletedAt: null, status: { in: ['PENDING', 'IN_PROGRESS'] }, OR: [{ employeeId: emp.id }, ...(emp.userId ? [{ assignedToId: emp.userId }] : [])] } }),
              this.prisma.attendance.count({ where: { customerId, employeeId: emp.id, date: { gte: startOfMonth }, OR: [{ isLate: true }, { status: 'LATE' }, { status: 'ABSENT' }] } }),
            ]);
            if (pendingTasks > 0 && lateOrAbsent > 0) {
              issueList.push(`${emp.firstName} ${emp.lastName}: ${pendingTasks} pending/overdue task(s) and ${lateOrAbsent} late mark(s)/absence(s) this month.`);
            }
          }

          return {
            queryType,
            summary: issueList.length > 0
              ? `Identified ${issueList.length} staff member(s) with both pending tasks and attendance/punctuality flags this month:`
              : 'No staff members currently have overlapping overdue tasks and attendance flags.',
            details: issueList,
          };
        }

        return { error: `Unsupported cross-module query type: ${queryType}` };
      }

      default:
        return { error: `Tool "${name}" is not implemented.` };
    }
  }

  // =========================================================================
  // PROVIDER 1: OPENAI (gpt-4o-mini / gpt-4o with tool calling)
  // =========================================================================

  private async executeWithOpenAi(
    user: any,
    customerId: number,
    userId: number,
    session: SessionMemory,
    message: string,
  ): Promise<NexusResponse | null> {
    const config = await this.integrationSettingsService.getOpenAiConfig().catch(() => null);
    if (!config?.apiKey || config.isEnabled === false) return null;

    const tools = this.getToolDeclarations().map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const systemPrompt = [
      'You are QB Nexus, the centralized AI Operations Manager and Executive Copilot for QB Suite.',
      'You have live access to tools that query and propose actions across CRM, HRM, Tasks, Data Capture, and Reports.',
      'Only use the declared tools. If the request needs a capability not declared, clearly say it is not available in Nexus yet.',
      'Rules:',
      '1. NEVER invent data or claim you made database changes yourself. Use tools to query facts.',
      '2. When the user asks to assign leads, change status, or create tasks, call the appropriate propose tool.',
      '3. If a matching search finds no records, say so explicitly.',
      '4. Be professional, concise, and helpful.',
      '5. Format figures in INR (₹) and dates cleanly.',
    ].join('\n');

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...session.history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      this.logger.warn(`OpenAI tool completion failed (HTTP ${response.status}): ${errText}`);
      return null;
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    if (!choice) return null;

    // Handle Tool Calls
    if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
      const verifiedResults: Array<{ name: string; data: any }> = [];

      for (const toolCall of choice.message.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {}

        const toolResult = await this.executeVerifiedTool(fnName, fnArgs, user, customerId, userId, session);
        verifiedResults.push({ name: fnName, data: toolResult });
        if (session.pendingAction) break;
      }
      return {
        answer: this.renderVerifiedToolResults(verifiedResults),
        provider: `OpenAI (${config.model || 'gpt-4o-mini'}) · verified database tools`,
        pendingAction: session.pendingAction || null,
        suggestions: this.generateFollowUpSuggestions(session),
      };
    }

    const directAnswer = choice.message?.content?.trim();
    if (directAnswer) {
      if (this.isBusinessDataQuestion(message)) return null;
      return {
        answer: directAnswer,
        provider: `OpenAI (${config.model || 'gpt-4o-mini'})`,
        pendingAction: session.pendingAction || null,
        suggestions: this.generateFollowUpSuggestions(session),
      };
    }

    return null;
  }

  // =========================================================================
  // PROVIDER 2: GOOGLE GEMINI (gemini-2.0-flash with function declarations)
  // =========================================================================

  private async executeWithGemini(
    user: any,
    customerId: number,
    userId: number,
    session: SessionMemory,
    message: string,
  ): Promise<NexusResponse | null> {
    const config = await this.integrationSettingsService.getGeminiConfig().catch(() => null);
    if (!config?.apiKey || config.isEnabled === false) return null;

    const functionDeclarations = this.getToolDeclarations().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const systemPrompt = [
      'You are QB Nexus, the centralized AI Operations Manager for QB Suite.',
      'Use the declared tools to fetch operational CRM/HRM data or to propose assignments/actions.',
      'Never invent numbers. If a tool proposes an action, explain the action to the user and prompt them to confirm. If a requested capability is not declared, say it is unavailable.',
    ].join('\n');

    const contents: any[] = session.history.slice(-6).map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

    const model = String(config.model || 'gemini-2.5-flash').match(/^gemini-[a-z0-9.-]+$/i)?.[0] || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: [{ functionDeclarations }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    const functionCallPart = parts.find((p: any) => p.functionCall);
    if (functionCallPart) {
      const fnName = functionCallPart.functionCall.name;
      const fnArgs = functionCallPart.functionCall.args || {};
      const toolResult = await this.executeVerifiedTool(fnName, fnArgs, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: fnName, data: toolResult }]),
        provider: `Google Gemini (${model}) · verified database tools`,
        pendingAction: session.pendingAction || null,
        suggestions: this.generateFollowUpSuggestions(session),
      };
    }

    const textAnswer = parts.map((p: any) => p.text || '').join('').trim();
    if (textAnswer) {
      if (this.isBusinessDataQuestion(message)) return null;
      return {
        answer: textAnswer,
        provider: `Google Gemini (${model})`,
        pendingAction: session.pendingAction || null,
        suggestions: this.generateFollowUpSuggestions(session),
      };
    }

    return null;
  }

  // =========================================================================
  // FALLBACK 3: DETERMINISTIC OPERATIONS ENGINE
  // =========================================================================

  private async executeDeterministic(
    user: any,
    customerId: number,
    userId: number,
    session: SessionMemory,
    message: string,
  ): Promise<NexusResponse> {
    const lower = message.toLowerCase();

    // 1. Assign leads intent
    if (/\b(assign|allocate|give)\b/i.test(lower) && /\b(lead|leads)\b/i.test(lower)) {
      // Extract count: e.g. "assign 5 leads" or "assign five leads"
      let count = 5;
      const numMatch = lower.match(/\b(\d+)\b/);
      if (numMatch) count = parseInt(numMatch[1], 10);
      else if (/\bfive\b/i.test(lower)) count = 5;
      else if (/\bten\b/i.test(lower)) count = 10;
      else if (/\btwo\b/i.test(lower)) count = 2;
      else if (/\bthree\b/i.test(lower)) count = 3;

      // Extract employee name: "to Rahul", "to Priya", etc.
      let empName = '';
      const toMatch = lower.match(/\bto\s+([a-zA-Z]+)/i);
      if (toMatch) empName = toMatch[1];
      else if (session.lastEmployeeName) empName = session.lastEmployeeName;

      if (!empName) {
        return {
          answer: 'Please specify which staff member you would like to assign the leads to (e.g., "Assign 5 leads to Rahul").',
          provider: 'Nexus Operations Guard',
          suggestions: ['Search active staff members', 'Show pending leads'],
        };
      }

      const res = await this.executeVerifiedTool('crm_propose_assign_leads', { employeeNameOrId: empName, count }, user, customerId, userId, session);
      if (res.error) {
        return { answer: res.error, provider: 'Nexus Operations Guard' };
      }

      return {
        answer: res.confirmationPrompt || res.description,
        provider: 'Nexus Operations Guard',
        pendingAction: session.pendingAction || null,
        suggestions: ['Confirm action', 'Cancel action'],
      };
    }

    // 2. Attendance query
    if (/\b(attendance|punch|punches|present|absent|late mark)\b/i.test(lower)) {
      const stats = await this.executeVerifiedTool('hrm_get_attendance_today', {}, user, customerId, userId, session);
      const answer = [
        `**Today's Attendance Summary (as of ${stats.asOf}):**`,
        ...(isUserAdmin(user) ? [`• **Active Staff:** ${stats.totalStaff}`] : []),
        `• **Present Today:** ${stats.present}`,
        `• **Late Marks:** ${stats.late}`,
        `• **Absent:** ${stats.absent}`,
        `• **Currently Checked In:** ${stats.currentlyWorking}`,
      ].join('\n');
      return {
        answer,
        provider: 'Nexus Operations Guard',
        suggestions: ['Show pending leads', 'View open tasks', 'Search employees'],
      };
    }

    // 3. Pending leads / CRM query
    if (/\b(lead|leads|pipeline|crm|prospect|prospects)\b/i.test(lower)) {
      const result = await this.executeVerifiedTool('crm_search_leads', { limit: 5 }, user, customerId, userId, session);
      if (result.leads.length === 0) {
        return {
          answer: 'There are currently no open pending leads in your CRM workspace.',
          provider: 'Nexus Operations Guard',
          suggestions: ['View open tasks', 'Data capture status', 'Today’s attendance'],
        };
      }

      const lines = [
        `Found **${result.totalCount} open lead(s)** in your CRM. Here are the top ${result.leads.length}:`,
      ];
      result.leads.forEach((l: any, i: number) => {
        lines.push(`${i + 1}. **${l.name}** (${l.company || 'Direct'}) — Status: \`${l.status}\`, Value: ${l.value}, Rep: ${l.assignedTo}`);
      });
      lines.push('\n*You can ask me to assign these leads to an employee (e.g. "Assign these leads to Rahul").*');

      return {
        answer: lines.join('\n'),
        provider: 'Nexus Operations Guard',
        suggestions: ['Assign 5 leads to Rahul', 'View sales pipeline', 'Check attendance today'],
      };
    }

    // 4. Staff / employee search
    if (/\b(employee|employees|staff|team|member|members)\b/i.test(lower)) {
      const result = await this.executeVerifiedTool('hrm_search_employees', { limit: 5 }, user, customerId, userId, session);
      if (result.employees.length === 0) {
        return { answer: 'No active staff members found.', provider: 'Nexus Operations Guard' };
      }
      const lines = [`Found **${result.totalCount} active staff member(s)**:`];
      result.employees.forEach((e: any, i: number) => {
        lines.push(`${i + 1}. **${e.name}** (\`${e.code}\`)${e.designation ? ` — ${e.designation}` : ''}${e.department ? ` (${e.department})` : ''}`);
      });
      return {
        answer: lines.join('\n'),
        provider: 'Nexus Operations Guard',
        suggestions: ['Today’s attendance', 'Assign pending leads', 'Show open tasks'],
      };
    }

    // 5. Tasks query
    if (/\b(task|tasks|todo|todos)\b/i.test(lower)) {
      const result = await this.executeVerifiedTool('tasks_search', { status: 'PENDING', limit: 5 }, user, customerId, userId, session);
      if (result.tasks.length === 0) {
        return { answer: 'There are no pending tasks right now.', provider: 'Nexus Operations Guard' };
      }
      const lines = [`You have **${result.totalCount} operational task(s)**:`];
      result.tasks.forEach((t: any, i: number) => {
        lines.push(`${i + 1}. **${t.title}** — Priority: \`${t.priority}\`, Due: ${t.dueDate}, Assignee: ${t.assignee}`);
      });
      return {
        answer: lines.join('\n'),
        provider: 'Nexus Operations Guard',
        suggestions: ['Show pending leads', 'Today’s attendance', 'Data capture stats'],
      };
    }

    // 6. Data Capture query
    if (/\b(capture|google places|places|job|jobs)\b/i.test(lower)) {
      const result = await this.executeVerifiedTool('data_capture_stats', {}, user, customerId, userId, session);
      const lines = [
        `**Data Capture Overview:**`,
        `• Total Extraction Jobs: **${result.totalCaptureJobs}**`,
        `• Total Places Captured: **${result.totalPlacesCaptured}**`,
      ];
      if (result.recentJobs.length > 0) {
        lines.push('\n**Recent Capture Jobs:**');
        result.recentJobs.forEach((j: any) => {
          lines.push(`• "${j.keyword}" in ${j.location}: ${j.captured} places captured on ${j.date}`);
        });
      }
      return {
        answer: lines.join('\n'),
        provider: 'Nexus Operations Guard',
        suggestions: ['Show pending leads', 'Check attendance today', 'View open tasks'],
      };
    }

    // 7. Cross-Module Intelligence
    if (/\b(leads?)\b/i.test(lower) && /\b(on leave|leave)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('cross_module_intelligence', { queryType: 'LEADS_ON_LEAVE' }, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'cross_module_intelligence', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['Show pending leads', 'Today’s attendance summary'],
      };
    }

    if (/\b(conversion|top sales)\b/i.test(lower) && /\b(attendance)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('cross_module_intelligence', { queryType: 'STAFF_PERFORMANCE_ATTENDANCE' }, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'cross_module_intelligence', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['View sales pipeline', 'Search active staff members'],
      };
    }

    if (/\b(overdue tasks?)\b/i.test(lower) && /\b(follow.?ups?|reminders?)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('cross_module_intelligence', { queryType: 'OVERDUE_TASKS_AND_FOLLOWUPS' }, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'cross_module_intelligence', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['Show open tasks', 'View today’s follow-ups'],
      };
    }

    if (/\b(pending tasks?|overdue)\b/i.test(lower) && /\b(attendance issues?|late marks?|absent)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('cross_module_intelligence', { queryType: 'STAFF_TASK_AND_ATTENDANCE_ISSUES' }, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'cross_module_intelligence', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['Today’s attendance', 'View open tasks'],
      };
    }

    // 8. Deals & Revenue Pipeline
    if (/\b(deals?|pipeline value|won deals?|revenue pipeline)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('crm_get_deals_summary', {}, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'crm_get_deals_summary', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['Show pending leads', 'View sales pipeline', 'Check customer accounts'],
      };
    }

    // 9. Customers query
    if (/\b(customers?|clients? accounts?|how many customers)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('crm_search_customers', {}, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'crm_search_customers', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['Show pending leads', 'View sales pipeline'],
      };
    }

    // 10. Follow-ups & Reminders query
    if (/\b(follow.?ups?|reminders?|scheduled visits?|visits? today)\b/i.test(lower)) {
      const timeframe = /\boverdue\b/i.test(lower) ? 'OVERDUE' : /\bupcoming\b/i.test(lower) ? 'UPCOMING' : 'TODAY';
      const res = await this.executeVerifiedTool('crm_get_follow_ups', { timeframe }, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'crm_get_follow_ups', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['Show pending leads', 'Today’s attendance'],
      };
    }

    // 11. Commission query
    if (/\b(commission|commissions|earned commission)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('crm_get_commissions_summary', {}, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'crm_get_commissions_summary', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['View sales pipeline', 'Show staff directory'],
      };
    }

    // 12. Payroll query
    if (/\b(payroll|salary payout|monthly salary|payroll runs?)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('hrm_get_payroll_summary', {}, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'hrm_get_payroll_summary', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['Check attendance report', 'Show active employees'],
      };
    }

    // 13. Loans and Claims query
    if (/\b(loans?|expense claims?|reimbursements?)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('hrm_get_loans_and_claims', {}, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'hrm_get_loans_and_claims', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['Check payroll summary', 'Show active employees'],
      };
    }

    // 14. Projects & Work Shoots
    if (/\b(projects?|works?|shoots?|production)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('projects_search', {}, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'projects_search', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['View open tasks', 'Show pending leads'],
      };
    }

    // 15. Communications & WhatsApp Campaigns
    if (/\b(campaigns?|whatsapp campaigns?|announcements?)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('communications_summary', {}, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'communications_summary', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['Show pending leads', 'View sales pipeline'],
      };
    }

    // 16. Reports Catalog and API Quota
    if (/\b(reports? catalog|google maps quota|maps quota|api usage)\b/i.test(lower)) {
      const res = await this.executeVerifiedTool('reports_get_catalog_and_stats', {}, user, customerId, userId, session);
      return {
        answer: this.renderVerifiedToolResults([{ name: 'reports_get_catalog_and_stats', data: res }]),
        provider: 'Nexus Operations Guard',
        suggestions: ['Today’s attendance', 'View sales pipeline'],
      };
    }

    if (this.isBusinessDataQuestion(message)) {
      return { answer: 'I cannot verify that business question with the supported QB Nexus capabilities yet. No data was inferred.', provider: 'Nexus Operations Guard' };
    }

    // General greeting and help stay independent of business data.
    if (/\b(hi|hello|hey|who are you|what can you do|help)\b/i.test(lower)) {
      return {
        answer: 'I am QB Nexus, your central AI Operations Manager for QB Suite. I can query real-time database records across CRM (leads, deals, customers, follow-ups, commissions), HRM (employees, attendance, leaves, payroll, loans, claims), Tasks, Production Projects, Data Capture, and Campaigns, as well as execute verified actions with your confirmation.',
        provider: 'Nexus Operations Guard',
        suggestions: ['Show pending leads', 'Today’s attendance summary', 'View pipeline deals', 'Payroll summary'],
      };
    }

    // 7. General Dashboard KPI Summary
    return {
      answer: 'I can help with supported CRM leads, attendance, leave, tasks, employee search, and Data Capture questions. Ask for a specific item or count so I can check the authorized records.',
      provider: 'Nexus Operations Guard',
      suggestions: ['Show today’s pending leads', 'Today’s attendance summary', 'View open tasks'],
    };
  }

  private generateFollowUpSuggestions(session: SessionMemory): string[] {
    if (session.pendingAction) {
      return ['Confirm action', 'Cancel action'];
    }
    if (session.lastLeadIds && session.lastLeadIds.length > 0) {
      return ['Assign 5 of these leads to Rahul', 'View sales pipeline', 'Check attendance today'];
    }
    return [
      'Show today’s pending leads',
      'Today’s attendance summary',
      'View open operational tasks',
    ];
  }
}
