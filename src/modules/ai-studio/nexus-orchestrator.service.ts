import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { isUserAdmin } from '../../common/utils/role.util';

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
  ): Promise<NexusResponse> {
    const customerId = Number(user?.customerId);
    const userId = Number(user?.id);
    if (!Number.isInteger(customerId) || customerId <= 0 || !Number.isInteger(userId) || userId <= 0) {
      throw new ForbiddenException('Your account is not scoped to a QB Suite business.');
    }

    const session = this.getOrCreateSession(customerId, userId);
    const message = String(rawMessage || '').trim();

    // 1. Check for Confirmation / Cancellation requests
    if (confirm !== undefined || actionId || this.isConfirmationOrCancellation(message)) {
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

    // 2. Try Primary Provider: OpenAI
    const openAiResult = await this.executeWithOpenAi(user, customerId, userId, session, message).catch((err) => {
      this.logger.warn(`[NEXUS_ORCHESTRATOR] OpenAI failed: ${err.message || err}`);
      return null;
    });
    if (openAiResult) {
      session.history.push({ role: 'assistant', content: openAiResult.answer });
      return openAiResult;
    }

    // 3. Try Secondary Provider: Google Gemini
    const geminiResult = await this.executeWithGemini(user, customerId, userId, session, message).catch((err) => {
      this.logger.warn(`[NEXUS_ORCHESTRATOR] Gemini fallback failed: ${err.message || err}`);
      return null;
    });
    if (geminiResult) {
      session.history.push({ role: 'assistant', content: geminiResult.answer });
      return geminiResult;
    }

    // 4. Fallback to Deterministic Engine
    this.logger.log(`[NEXUS_ORCHESTRATOR] Using Deterministic Engine fallback`);
    const deterministicResult = await this.executeDeterministic(user, customerId, userId, session, message);
    session.history.push({ role: 'assistant', content: deterministicResult.answer });
    return deterministicResult;
  }

  // =========================================================================
  // CONFIRMATION WORKFLOW ENGINE
  // =========================================================================

  private isConfirmationOrCancellation(message: string): boolean {
    const lower = message.toLowerCase().trim();
    return (
      /^(confirm|yes|proceed|do it|sure|approved|execute|confirm action)$/i.test(lower) ||
      /^(cancel|abort|stop|no|reject|dismiss|never mind|cancel action)$/i.test(lower)
    );
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
        const { leadIds, employeeId, userId: assigneeUserId, employeeName } = action.payload;
        if (!Array.isArray(leadIds) || leadIds.length === 0) {
          throw new BadRequestException('No lead IDs provided for assignment.');
        }

        // Verify all leads belong to this customer
        const verifiedLeads = await this.prisma.lead.findMany({
          where: { id: { in: leadIds }, customerId, deletedAt: null },
          select: { id: true, title: true, firstName: true, lastName: true, companyName: true },
        });

        if (verifiedLeads.length === 0) {
          throw new BadRequestException('None of the target leads were found in your business.');
        }

        const validIds = verifiedLeads.map((l) => l.id);

        // Execute DB updates
        await this.prisma.lead.updateMany({
          where: { id: { in: validIds }, customerId },
          data: {
            assignedToId: assigneeUserId || null,
            employeeId: employeeId || null,
            updatedAt: new Date(),
          },
        });

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
        const { title, description, priority, dueDate, assigneeUserId, employeeId, assigneeName } = action.payload;

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
        const { leadId, status, oldStatus } = action.payload;
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { status, updatedAt: new Date() },
        });

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
        const { taskId, status, oldStatus } = action.payload;
        await this.prisma.task.update({
          where: { id: taskId },
          data: {
            status,
            ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
            updatedAt: new Date(),
          },
        });

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

  private async executeTool(
    name: string,
    args: any,
    user: any,
    customerId: number,
    userId: number,
    session: SessionMemory,
  ): Promise<any> {
    const isAdmin = isUserAdmin(user);
    const accessScope = isAdmin ? {} : { assignedToId: userId };

    switch (name) {
      case 'crm_search_leads': {
        const { status, priority, query, limit = 5, onlyUnassigned } = args || {};
        const openStatuses = ['NEW', 'CONTACTED', 'CALL_BACK', 'DETAILS_SENT', 'FOLLOW_UP', 'VISIT_SCHEDULED', 'VISIT_DONE', 'PROPOSAL_SENT', 'NEGOTIATION', 'FINAL_CALL'];
        
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
          where.priority = priority.toUpperCase();
        }

        if (query) {
          where.OR = [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { companyName: { contains: query, mode: 'insensitive' } },
            { title: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ];
        }

        const [totalCount, leads] = await Promise.all([
          this.prisma.lead.count({ where }),
          this.prisma.lead.findMany({
            where,
            take: Math.min(limit, 20),
            orderBy: { createdAt: 'desc' },
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

        if (!employee) {
          return { error: `Active staff member "${empQuery}" not found. Please verify the employee name.` };
        }

        const employeeFullName = `${employee.firstName} ${employee.lastName}`.trim();
        session.lastEmployeeId = employee.id;
        session.lastEmployeeName = employeeFullName;

        // 2. Identify target leads
        let targetLeadIds: number[] = [];
        if (Array.isArray(leadIds) && leadIds.length > 0) {
          targetLeadIds = leadIds.map(Number).filter((n) => !isNaN(n));
        } else if (session.lastLeadIds && session.lastLeadIds.length > 0) {
          targetLeadIds = session.lastLeadIds.slice(0, Math.min(count, 20));
        } else {
          // Fetch pending leads
          const openLeads = await this.prisma.lead.findMany({
            where: {
              customerId,
              deletedAt: null,
              status: { notIn: ['WON', 'LOST', 'CANCELLED', 'CONVERTED'] },
              assignedToId: null,
            },
            take: Math.min(count, 20),
            select: { id: true },
            orderBy: { createdAt: 'desc' },
          });
          targetLeadIds = openLeads.map((l) => l.id);
        }

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
        const { leadId, status } = args || {};
        const id = Number(leadId);
        if (!id || !status) return { error: 'Lead ID and target status are required.' };

        const lead = await this.prisma.lead.findFirst({
          where: { id, customerId, deletedAt: null },
          select: { id: true, title: true, firstName: true, lastName: true, companyName: true, status: true },
        });

        if (!lead) return { error: `Lead #${id} not found.` };

        const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || lead.companyName || lead.title || `#${id}`;
        const targetStatus = status.toUpperCase().trim();

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
        const { query, department, limit = 5 } = args || {};
        const where: any = { customerId, status: 'ACTIVE' };

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
        const { status = 'PENDING', limit = 5 } = args || {};
        const where: any = { customerId };
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
        const { status, priority, query, limit = 5 } = args || {};
        const where: any = { customerId, deletedAt: null };

        if (!isAdmin) {
          where.OR = [
            { assignedToId: userId },
            ...(session.lastEmployeeId ? [{ employeeId: session.lastEmployeeId }] : []),
          ];
        }

        if (status && status.toUpperCase() !== 'ALL') {
          where.status = status.toUpperCase();
        }

        if (priority) {
          where.priority = priority.toUpperCase();
        }

        if (query) {
          where.OR = [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ];
        }

        const tasks = await this.prisma.task.findMany({
          where,
          take: Math.min(limit, 20),
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            assignedTo: { select: { firstName: true, lastName: true } },
            employee: { select: { firstName: true, lastName: true, employeeCode: true } },
          },
        });

        return {
          totalCount: tasks.length,
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            dueDate: t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-IN') : 'None',
            assignee: t.employee ? `${t.employee.firstName} ${t.employee.lastName}` : (t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : 'Unassigned'),
          })),
        };
      }

      case 'tasks_propose_create': {
        const { title, description, priority = 'MEDIUM', dueDate, assigneeNameOrId } = args || {};
        if (!title) return { error: 'Task title is required.' };

        let employee = null;
        if (assigneeNameOrId) {
          const empQuery = String(assigneeNameOrId).trim();
          employee = await this.prisma.employee.findFirst({
            where: {
              customerId,
              status: 'ACTIVE',
              OR: [
                { firstName: { contains: empQuery, mode: 'insensitive' } },
                { lastName: { contains: empQuery, mode: 'insensitive' } },
              ],
            },
            select: { id: true, userId: true, firstName: true, lastName: true, employeeCode: true },
          });
        }

        const assigneeFullName = employee ? `${employee.firstName} ${employee.lastName}` : null;
        const proposalId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const proposal: PendingActionProposal = {
          id: proposalId,
          type: 'CREATE_TASK',
          title: `Create Task: "${title}"`,
          description: `Create new task with priority ${priority}${assigneeFullName ? ` assigned to ${assigneeFullName}` : ''}`,
          payload: {
            title,
            description,
            priority: priority.toUpperCase(),
            dueDate,
            employeeId: employee?.id || null,
            assigneeUserId: employee?.userId || null,
            assigneeName: assigneeFullName,
          },
          summary: {
            'Title': title,
            'Priority': priority.toUpperCase(),
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
          confirmationPrompt: `Ready to create task "${title}"${assigneeFullName ? ` for ${assigneeFullName}` : ''}. Would you like me to proceed?`,
        };
      }

      case 'data_capture_stats': {
        const [totalJobs, totalPlaces, recentJobs] = await Promise.all([
          this.prisma.dataCaptureJob.count({ where: { customerId } }),
          this.prisma.dataCapturePlace.count({ where: { customerId } }),
          this.prisma.dataCaptureJob.findMany({
            where: { customerId },
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
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);

        const [totalLeads, todayLeads, totalStaff, presentStaff, openTasks, totalPlaces] = await Promise.all([
          this.prisma.lead.count({ where: { customerId, deletedAt: null } }),
          this.prisma.lead.count({ where: { customerId, deletedAt: null, createdAt: { gte: startOfDay } } }),
          this.prisma.employee.count({ where: { customerId, status: 'ACTIVE' } }),
          this.prisma.attendance.count({ where: { customerId, date: { gte: startOfDay } } }),
          this.prisma.task.count({ where: { customerId, deletedAt: null, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
          this.prisma.dataCapturePlace.count({ where: { customerId } }),
        ]);

        return {
          crm: { totalLeads, newLeadsToday: todayLeads },
          hrm: { activeStaff: totalStaff, presentToday: presentStaff, attendanceRate: totalStaff > 0 ? `${Math.round((presentStaff / totalStaff) * 100)}%` : '0%' },
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
      'Rules:',
      '1. NEVER invent data or claim you made database changes yourself. Use tools to query facts.',
      '2. When the user asks to assign leads, change status, or create tasks, call the appropriate propose tool.',
      '3. Be professional, concise, and helpful.',
      '4. Format figures in INR (₹) and dates cleanly.',
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
        model: 'gpt-4o-mini',
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
          model: 'gpt-4o-mini',
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
            provider: 'OpenAI (gpt-4o-mini)',
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
        provider: 'OpenAI (gpt-4o-mini)',
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
      'Never invent numbers. If a tool proposes an action, explain the action to the user and prompt them to confirm.',
    ].join('\n');

    const contents: any[] = session.history.slice(-6).map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(config.apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
            provider: 'Google Gemini (gemini-2.0-flash)',
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
        provider: 'Google Gemini (gemini-2.0-flash)',
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
