import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { isUserAdmin } from '../../common/utils/role.util';
import { STANDARD_PERMISSIONS } from '../../common/constants/rbac.constants';
import { BUSINESS_TIMEZONE, formatTimeInTimezone, getBusinessDayRange, getBusinessDate } from '../../common/utils/timezone.util';

class NexusToolExecutionError extends Error {
  constructor(readonly toolName: string) {
    super(`QB Nexus could not retrieve data for ${toolName}.`);
    this.name = 'NexusToolExecutionError';
  }
}

export interface PendingActionProposal {
  id: string;
  type: 'ASSIGN_LEADS' | 'UPDATE_LEAD_STATUS' | 'CREATE_TASK' | 'UPDATE_TASK_STATUS';
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
  { module: 'CRM', capability: 'Search leads, details, pipeline', access: 'READ', verified: true },
  { module: 'CRM', capability: 'Assign leads, update lead status', access: 'CONFIRMED_WRITE', verified: true },
  { module: 'HRM', capability: 'Search employees, today attendance, leave requests', access: 'READ', verified: true },
  { module: 'TASKS', capability: 'Search tasks, create tasks', access: 'READ_OR_CONFIRMED_WRITE', verified: true },
  { module: 'DATA_CAPTURE', capability: 'Capture job/place counts and recent jobs', access: 'READ', verified: true },
  { module: 'DASHBOARD', capability: 'Cross-module KPI summary', access: 'READ', verified: true },
  { module: 'REPORTS', capability: 'Payroll, commissions, custom exports', access: 'UNAVAILABLE', verified: false },
  { module: 'COMMUNICATIONS', capability: 'Send campaigns or notifications', access: 'UNAVAILABLE', verified: false },
  { module: 'SYSTEM', capability: 'Manage roles, permissions, integrations', access: 'UNAVAILABLE', verified: false },
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
        case 'hrm_search_employees': {
          const employees = Array.isArray(data.employees) ? data.employees : [];
          lines.push(`Found ${Number(data.totalCount) || 0} employee record(s) within your permitted scope.`);
          for (const employee of employees) lines.push(`${employee.name} (${employee.code})${employee.designation ? ` — ${employee.designation}` : ''}${employee.department ? `, ${employee.department}` : ''}.`);
          break;
        }
        case 'hrm_get_attendance_today':
          lines.push(`Attendance as of ${data.asOf || formatTimeInTimezone(new Date(), BUSINESS_TIMEZONE)}: ${data.totalStaff} active staff, ${data.present} present, ${data.late} late, ${data.absent} absent, ${data.currentlyWorking} currently checked in.`);
          break;
        case 'hrm_get_leave_requests': {
          const requests = Array.isArray(data.requests) ? data.requests : [];
          lines.push(`Found ${Number(data.totalReturned) || 0} matching leave request(s).`);
          for (const request of requests) lines.push(`#${request.id} ${request.employee} — ${request.type}, ${request.status}, ${request.from} to ${request.to} (${request.days} day(s)).`);
          break;
        }
        case 'tasks_search': {
          const tasks = Array.isArray(data.tasks) ? data.tasks : [];
          lines.push(`Found ${Number(data.totalCount) || 0} matching task(s).`);
          for (const task of tasks) lines.push(`#${task.id} ${task.title} — ${task.status}, ${task.priority}, due ${task.dueDate}, assigned to ${task.assignee}.`);
          break;
        }
        case 'tasks_propose_create':
        case 'crm_propose_assign_leads':
        case 'crm_propose_update_lead_status':
          lines.push(String(data.confirmationPrompt || data.description || 'A confirmation is required before this change.'));
          break;
        case 'data_capture_stats':
          lines.push(`Data Capture: ${data.totalCaptureJobs} job(s), ${data.totalPlacesCaptured} captured place(s).`);
          break;
        case 'dashboard_kpi_summary':
          lines.push(`Business summary for your permitted scope: ${data.crm.totalLeads} lead(s), ${data.operations.openTasks} open task(s), ${data.operations.capturedPlaces} captured place(s).`);
          if (data.hrm.activeStaff !== undefined) lines.push(`HRM: ${data.hrm.presentToday} present of ${data.hrm.activeStaff} active staff (${data.hrm.attendanceRate}).`);
          else if (data.hrm.ownAttendanceRecordsToday !== undefined) lines.push(`Your attendance records today: ${data.hrm.ownAttendanceRecordsToday}.`);
          break;
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
      crm_search_leads: [['LEADS', 'VIEW']], crm_get_lead_details: [['LEADS', 'VIEW']], crm_pipeline_summary: [['LEADS', 'VIEW']],
      crm_propose_assign_leads: [['LEADS', 'VIEW'], ['LEADS', 'EDIT']], crm_propose_update_lead_status: [['LEADS', 'VIEW'], ['LEADS', 'CHANGE_STAGE']],
      hrm_search_employees: [['EMPLOYEES', 'VIEW']], hrm_get_attendance_today: [['ATTENDANCE', 'VIEW']],
      hrm_get_leave_requests: [['LEAVE', 'VIEW']], tasks_search: [['TASKS', 'VIEW']], tasks_propose_create: [['TASKS', 'CREATE']],
      data_capture_stats: [['DATA_CAPTURE', 'VIEW']], dashboard_kpi_summary: [['DASHBOARD', 'VIEW']],
    };
    for (const [module, action] of readPermissions[name] || []) this.requirePermission(user, module, action);
    const accessScope = isAdmin ? {} : { assignedToId: userId };

    switch (name) {
      case 'crm_search_leads': {
        this.requirePermission(user, 'LEADS', 'VIEW');
        const { status, priority, query, limit = 5, offset = 0, onlyUnassigned, source, missingPhone, createdAfter, createdBefore, sortBy, sortOrder } = args || {};
        
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
        if (createdAfter || createdBefore) {
          const dateFilter: any = {};
          if (createdAfter && Number.isFinite(new Date(createdAfter).getTime())) dateFilter.gte = new Date(createdAfter);
          if (createdBefore && Number.isFinite(new Date(createdBefore).getTime())) dateFilter.lt = new Date(createdBefore);
          if (Object.keys(dateFilter).length) where.createdAt = dateFilter;
        }

        if (query) {
          const search = [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { companyName: { contains: query, mode: 'insensitive' } },
            { title: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
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
          where: { customerId, deletedAt: null, ...accessScope },
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
        this.requirePermission(user, 'EMPLOYEES', 'VIEW');
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
        this.requirePermission(user, 'EMPLOYEES', 'VIEW');
        const { query, department, limit = 5 } = args || {};
        const where: any = { customerId, status: 'ACTIVE' };
        if (!isAdmin) {
          const ownEmployee = await this.prisma.employee.findFirst({ where: { customerId, userId }, select: { id: true } });
          if (!ownEmployee) return { totalCount: 0, returnedCount: 0, employees: [] };
          where.id = ownEmployee.id;
        }

        if (query) {
          where.OR = [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { employeeCode: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ];
        }

        if (department) {
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
              email: true,
              phone: true,
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
        if (!isAdmin) {
          const employee = await this.prisma.employee.findFirst({ where: { customerId, userId }, select: { id: true } });
          if (!employee) return { totalStaff: 0, present: 0, late: 0, absent: 0, currentlyWorking: 0, recentPunches: [] };
          const now = new Date();
          const start = new Date(now); start.setHours(0, 0, 0, 0);
          const end = new Date(now); end.setHours(23, 59, 59, 999);
          const attendance = await this.prisma.attendance.findMany({
            where: { customerId, employeeId: employee.id, date: { gte: start, lte: end } },
            include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
          });
          return { totalStaff: 1, present: attendance.length, late: attendance.filter((item) => item.isLate).length, absent: attendance.length ? 0 : 1, currentlyWorking: attendance.filter((item) => item.punchIn && !item.punchOut).length, recentPunches: attendance.map((item) => ({ employee: `${item.employee.firstName} ${item.employee.lastName}`, code: item.employee.employeeCode })) };
        }
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);

        const [totalEmployees, attendances] = await Promise.all([
          this.prisma.employee.count({ where: { customerId, status: 'ACTIVE' } }),
          this.prisma.attendance.findMany({
            where: {
              customerId,
              date: { gte: startOfDay, lte: endOfDay },
            },
            include: {
              employee: { select: { firstName: true, lastName: true, employeeCode: true } },
            },
          }),
        ]);

        const presentCount = attendances.length;
        const lateCount = attendances.filter((a) => a.isLate).length;
        const absentCount = Math.max(0, totalEmployees - presentCount);
        const checkedInNow = attendances.filter((a) => a.punchIn && !a.punchOut).length;

        return {
          asOf: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          totalStaff: totalEmployees,
          present: presentCount,
          late: lateCount,
          absent: absentCount,
          currentlyWorking: checkedInNow,
          recentPunches: attendances.slice(0, 5).map((a) => ({
            employee: `${a.employee.firstName} ${a.employee.lastName}`,
            code: a.employee.employeeCode,
            punchIn: a.punchIn ? new Date(a.punchIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
            isLate: Boolean(a.isLate),
          })),
        };
      }

      case 'hrm_get_leave_requests': {
        this.requirePermission(user, 'LEAVE', 'VIEW');
        const { status = 'PENDING', limit = 5 } = args || {};
        const where: any = { customerId };
        if (!isAdmin) {
          const employee = await this.prisma.employee.findFirst({ where: { customerId, userId }, select: { id: true } });
          if (!employee) return { totalReturned: 0, requests: [] };
          where.employeeId = employee.id;
        }
        if (!isAdmin) {
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
            from: l.fromDate ? new Date(l.fromDate).toLocaleDateString('en-IN') : '—',
            to: l.toDate ? new Date(l.toDate).toLocaleDateString('en-IN') : '—',
            days: l.days,
            reason: l.reason || 'None specified',
            status: l.status,
          })),
        };
      }

      case 'tasks_search': {
        this.requirePermission(user, 'TASKS', 'VIEW');
        const { status, priority, query, limit = 5, offset = 0, assignedTo, overdue, dueAfter, dueBefore, sortBy, sortOrder } = args || {};
        const where: any = { customerId, deletedAt: null };

        if (!isAdmin) {
          const ownEmployee = await this.prisma.employee.findFirst({ where: { customerId, userId }, select: { id: true } });
          where.OR = [
            { assignedToId: userId },
            ...(ownEmployee ? [{ employeeId: ownEmployee.id }] : []),
          ];
        }

        if (status && status.toUpperCase() !== 'ALL') {
          const validStatuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED', 'BLOCKED'];
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
        } else if (dueAfter || dueBefore) {
          const dateFilter: any = {};
          if (dueAfter && Number.isFinite(new Date(dueAfter).getTime())) dateFilter.gte = new Date(dueAfter);
          if (dueBefore && Number.isFinite(new Date(dueBefore).getTime())) dateFilter.lt = new Date(dueBefore);
          if (Object.keys(dateFilter).length) where.AND = [...(where.AND || []), { OR: [{ dueDate: dateFilter }, { dueAt: dateFilter }] }];
        }

        if (query) {
          const search = [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
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
            dueDate: t.dueDate || t.dueAt ? new Date(t.dueDate || t.dueAt).toLocaleDateString('en-IN') : 'None',
            assignee: t.employee ? `${t.employee.firstName} ${t.employee.lastName}` : (t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : 'Unassigned'),
          })),
        };
      }

      case 'tasks_propose_create': {
        this.requirePermission(user, 'TASKS', 'CREATE');
        if (args?.assigneeNameOrId) this.requirePermission(user, 'EMPLOYEES', 'VIEW');
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
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const leadScope: any = { customerId, deletedAt: null, ...accessScope };
        const taskScope: any = { customerId, deletedAt: null, status: { in: ['PENDING', 'IN_PROGRESS'] } };
        if (!isAdmin) {
          const ownEmployee = await this.prisma.employee.findFirst({ where: { customerId, userId }, select: { id: true } });
          taskScope.OR = [{ assignedToId: userId }, ...(ownEmployee ? [{ employeeId: ownEmployee.id }] : [])];
        }

        const [totalLeads, todayLeads, totalStaff, presentStaff, openTasks, totalPlaces] = await Promise.all([
          this.prisma.lead.count({ where: leadScope }),
          this.prisma.lead.count({ where: { ...leadScope, createdAt: { gte: startOfDay } } }),
          this.prisma.employee.count({ where: isAdmin ? { customerId, status: 'ACTIVE' } : { customerId, userId, status: 'ACTIVE' } }),
          this.prisma.attendance.count({ where: { customerId, date: { gte: startOfDay }, ...(!isAdmin ? { employee: { userId } } : {}) } }),
          this.prisma.task.count({ where: taskScope }),
          this.prisma.dataCapturePlace.count({ where: { customerId, ...(!isAdmin ? { job: { userId } } : {}) } }),
        ]);

        return {
          crm: { totalLeads, newLeadsToday: todayLeads },
          hrm: isAdmin ? { activeStaff: totalStaff, presentToday: presentStaff, attendanceRate: totalStaff > 0 ? `${Math.round((presentStaff / totalStaff) * 100)}%` : '0%' } : { ownAttendanceRecordsToday: presentStaff },
          operations: { openTasks, capturedPlaces: totalPlaces },
        };
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
      messages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {}

        const toolResult = await this.executeTool(fnName, fnArgs, user, customerId, userId, session);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      // Second round to get final natural-language response
      const followUp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || 'gpt-4o-mini',
          messages,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (followUp.ok) {
        const followData = await followUp.json();
        const finalAnswer = followData?.choices?.[0]?.message?.content?.trim();
        if (finalAnswer) {
          return {
            answer: finalAnswer,
            provider: `OpenAI (${config.model || 'gpt-4o-mini'})`,
            pendingAction: session.pendingAction || null,
            suggestions: this.generateFollowUpSuggestions(session),
          };
        }
      }
    }

    const directAnswer = choice.message?.content?.trim();
    if (directAnswer) {
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
      const toolResult = await this.executeTool(fnName, fnArgs, user, customerId, userId, session);

      // Follow-up with function response
      contents.push({ role: 'model', parts: [{ functionCall: functionCallPart.functionCall }] });
      contents.push({
        role: 'function',
        parts: [{
          functionResponse: {
            name: fnName,
            response: { result: toolResult },
          },
        }],
      });

      const followUp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (followUp.ok) {
        const followData = await followUp.json();
        const answer = followData?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('').trim();
        if (answer) {
          return {
            answer,
            provider: `Google Gemini (${model})`,
            pendingAction: session.pendingAction || null,
            suggestions: this.generateFollowUpSuggestions(session),
          };
        }
      }
    }

    const textAnswer = parts.map((p: any) => p.text || '').join('').trim();
    if (textAnswer) {
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

      const res = await this.executeTool('crm_propose_assign_leads', { employeeNameOrId: empName, count }, user, customerId, userId, session);
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
      const stats = await this.executeTool('hrm_get_attendance_today', {}, user, customerId, userId, session);
      const answer = [
        `**Today's Attendance Summary (as of ${stats.asOf}):**`,
        `• **Active Staff:** ${stats.totalStaff}`,
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
      const result = await this.executeTool('crm_search_leads', { limit: 5 }, user, customerId, userId, session);
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
      const result = await this.executeTool('hrm_search_employees', { limit: 5 }, user, customerId, userId, session);
      if (result.employees.length === 0) {
        return { answer: 'No active staff members found.', provider: 'Nexus Operations Guard' };
      }
      const lines = [`Found **${result.totalCount} active staff member(s)**:`];
      result.employees.forEach((e: any, i: number) => {
        lines.push(`${i + 1}. **${e.name}** (\`${e.code}\`) — ${e.designation} (${e.department})`);
      });
      return {
        answer: lines.join('\n'),
        provider: 'Nexus Operations Guard',
        suggestions: ['Today’s attendance', 'Assign pending leads', 'Show open tasks'],
      };
    }

    // 5. Tasks query
    if (/\b(task|tasks|todo|todos)\b/i.test(lower)) {
      const result = await this.executeTool('tasks_search', { limit: 5 }, user, customerId, userId, session);
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
      const result = await this.executeTool('data_capture_stats', {}, user, customerId, userId, session);
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

    // 7. General Dashboard KPI Summary
    const summary = await this.executeTool('dashboard_kpi_summary', {}, user, customerId, userId, session);
    const lines = [
      `👋 I am **QB Nexus**, your central AI Operations Manager. Here is your current business pulse:`,
      `• **CRM:** ${summary.crm.totalLeads} total leads (${summary.crm.newLeadsToday} new today)`,
      `• **HRM:** ${summary.hrm.presentToday} of ${summary.hrm.activeStaff} staff present today (${summary.hrm.attendanceRate} attendance)`,
      `• **Operations:** ${summary.operations.openTasks} open tasks, ${summary.operations.capturedPlaces} captured places`,
      `\nHow can I help you? You can ask me to search leads, assign leads to employees, check attendance, or inspect tasks.`,
    ];

    return {
      answer: lines.join('\n'),
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
