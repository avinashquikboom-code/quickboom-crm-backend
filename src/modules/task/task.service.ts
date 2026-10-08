import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  ReallocateTaskDto,
  SubmitTaskProofDto,
  ReviewTaskDto,
} from './dto/task.dto';
import { TaskPriority, TaskStatus, WorkStatus } from '@prisma/client';
import { EmployeeCommunicationService } from '../notification/employee-communication.service';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private readonly employeeCommunication?: EmployeeCommunicationService,
  ) {}

  private parseDueDateTime(dateStr?: string, timeStr?: string): { dueDate: Date | null; dueAt: Date | null } {
    if (!dateStr) return { dueDate: null, dueAt: null };

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return { dueDate: null, dueAt: null };

    if (!timeStr) {
      return { dueDate: date, dueAt: date };
    }

    try {
      const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const meridian = match[3]?.toUpperCase();

        if (meridian === 'PM' && hours < 12) hours += 12;
        if (meridian === 'AM' && hours === 12) hours = 0;

        const combined = new Date(date);
        combined.setHours(hours, minutes, 0, 0);
        return { dueDate: date, dueAt: combined };
      }
    } catch {
      // Fallback
    }

    return { dueDate: date, dueAt: date };
  }

  public async getAuthenticatedEmployee(user: any, _customerId?: number | string) {
    if (!user) {
      throw new ForbiddenException('Authenticated user context required');
    }

    const identity: any[] = [];
    const userId = Number(user.id);
    const tokenEmployeeId = Number(user.employeeId || user.employee?.id);
    if (Number.isInteger(userId) && userId > 0) {
      identity.push({ userId });
    }
    if (Number.isInteger(tokenEmployeeId) && tokenEmployeeId > 0) {
      identity.push({ id: tokenEmployeeId });
    }
    const email = typeof user.email === 'string' ? user.email.trim() : '';
    if (email) {
      identity.push({ email: { equals: email, mode: 'insensitive' } });
    }
    if (identity.length === 0) {
      throw new ForbiddenException('No active employee record linked to current user account');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { OR: identity, status: 'ACTIVE' },
      include: {
        office: true,
        department: true,
        designation: true,
      },
    });

    if (!employee) {
      throw new ForbiddenException('No active employee record linked to current user account');
    }

    this.logger.log(
      `[TASK_API] employeeId=${employee.id} employeeCode=${employee.employeeCode} userId=${employee.userId ?? 'none'}`,
    );

    return employee;
  }

  /**
   * Tasks the signed-in employee may see: their own assignment, or a task
   * assigned to someone on a team they belong to or lead.
   * Do not require task.customerId to equal the employer id. Client work is
   * stored against the client customer, while the employee belongs to the agency.
   */
  private async buildMyTaskOwnership(employee: { id: number; userId: number | null; departmentId: number | null }) {
    const [memberships, ledTeams] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { employeeId: employee.id },
        select: { teamId: true },
      }),
      this.prisma.team.findMany({
        where: { leaderId: employee.id },
        select: { id: true },
      }),
    ]);
    const teamIds = [
      ...new Set([
        ...memberships.map((m) => m.teamId),
        ...ledTeams.map((t) => t.id),
      ]),
    ];

    let teammateIds: number[] = [];
    if (teamIds.length > 0) {
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: { in: teamIds } },
        select: { employeeId: true },
      });
      teammateIds = [
        ...new Set(
          members
            .map((m) => m.employeeId)
            .filter((id) => id !== employee.id),
        ),
      ];
    }

    const orOwnership: any[] = [{ employeeId: employee.id }];
    if (employee.userId) {
      orOwnership.push({ assignedToId: employee.userId });
    }
    if (teammateIds.length > 0) {
      orOwnership.push({ employeeId: { in: teammateIds } });
    }
    if (employee.departmentId) {
      orOwnership.push({
        employeeId: null,
        departmentId: employee.departmentId,
      });
    }

    return { orOwnership, teamIds };
  }

  async getMetrics(customerId?: number | string) {
    const numCustomerId = Number(customerId);
    const customerFilter = !isNaN(numCustomerId) && numCustomerId > 0 ? { customerId: numCustomerId } : {};
    const now = new Date();

    const [
      total,
      pending,
      inProgress,
      underReview,
      completed,
      rejected,
      urgent,
      high,
      medium,
      low,
      allTasks,
    ] = await Promise.all([
      this.prisma.task.count({ where: { ...customerFilter, deletedAt: null } }),
      this.prisma.task.count({ where: { ...customerFilter, status: TaskStatus.PENDING, deletedAt: null } }),
      this.prisma.task.count({ where: { ...customerFilter, status: TaskStatus.IN_PROGRESS, deletedAt: null } }),
      this.prisma.task.count({
        where: {
          ...customerFilter,
          status: { in: [TaskStatus.SUBMITTED, TaskStatus.UNDER_REVIEW] },
          deletedAt: null,
        },
      }),
      this.prisma.task.count({ where: { ...customerFilter, status: TaskStatus.COMPLETED, deletedAt: null } }),
      this.prisma.task.count({ where: { ...customerFilter, status: TaskStatus.REJECTED, deletedAt: null } }),
      this.prisma.task.count({ where: { ...customerFilter, priority: TaskPriority.URGENT, deletedAt: null } }),
      this.prisma.task.count({ where: { ...customerFilter, priority: TaskPriority.HIGH, deletedAt: null } }),
      this.prisma.task.count({ where: { ...customerFilter, priority: TaskPriority.MEDIUM, deletedAt: null } }),
      this.prisma.task.count({ where: { ...customerFilter, priority: TaskPriority.LOW, deletedAt: null } }),
      this.prisma.task.findMany({
        where: {
          ...customerFilter,
          deletedAt: null,
          status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
          dueAt: { not: null },
        },
        select: { id: true, dueAt: true, priority: true },
      }),
    ]);

    const overdueTasks = allTasks.filter((t) => t.dueAt && t.dueAt < now);
    const overdue = overdueTasks.length;
    const overdueUrgent = overdueTasks.filter((t) => t.priority === TaskPriority.URGENT).length;
    const overdueHigh = overdueTasks.filter((t) => t.priority === TaskPriority.HIGH).length;

    return {
      total,
      pending,
      inProgress,
      awaitingReview: underReview,
      completed,
      rejected,
      overdue,
      urgent,
      high,
      medium,
      low,
      overdueUrgent,
      overdueHigh,
    };
  }

  async create(customerId: number | string, createdById: number | string, dto: CreateTaskDto) {
    const numCustomerId = Number(customerId);
    const numCreatedById = Number(createdById);

    const { dueDate, dueAt } = this.parseDueDateTime(dto.dueDate, dto.dueTime);

    // Auto-generate human-readable task number
    const count = await this.prisma.task.count({ where: { customerId: numCustomerId } });
    const taskNumber = `TSK-${(count + 1001).toString()}`;

    // Resolve employee if provided
    let employeeId = dto.employeeId ? Number(dto.employeeId) : undefined;
    let employee: any = null;
    if (employeeId) {
      employee = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        include: { department: true, designation: true },
      });
      if (!employee || employee.status === 'INACTIVE') {
        throw new BadRequestException('Selected employee does not exist or is inactive');
      }
    }

    // Execute in atomic transaction
    const task = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          customerId: numCustomerId,
          createdById: numCreatedById,
          taskNumber,
          title: dto.title,
          description: dto.description,
          priority: dto.priority,
          status: TaskStatus.PENDING,
          dueDate,
          dueTime: dto.dueTime,
          dueAt,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          startTime: dto.startTime,
          category: dto.category,
          employeeId: employeeId,
          departmentId: dto.departmentId ? Number(dto.departmentId) : employee?.departmentId || undefined,
          designationId: dto.designationId ? Number(dto.designationId) : employee?.designationId || undefined,
          assignedToId: dto.assignedToId
            ? Number(dto.assignedToId)
            : employee?.userId || undefined,
          notes: dto.notes,
        },
        include: {
          employee: { include: { department: true, designation: true } },
          department: true,
          designation: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      // 1. Initial Creation History
      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          action: 'TASK_CREATED',
          performedById: numCreatedById,
          performedByName: 'HR Administrator',
          newStatus: 'PENDING',
          newEmployeeId: employeeId,
          newEmployeeName: employee ? `${employee.firstName} ${employee.lastName}` : 'Unassigned',
          comment: `Task created with priority ${dto.priority} due on ${dto.dueDate} ${dto.dueTime}.`,
        },
      });

      // 2. Initial Allocation History
      if (employee) {
        await tx.taskHistory.create({
          data: {
            taskId: task.id,
            action: 'TASK_ASSIGNED',
            performedById: numCreatedById,
            performedByName: 'HR Administrator',
            newEmployeeId: employee.id,
            newEmployeeName: `${employee.firstName} ${employee.lastName}`,
            comment: `Task allocated to ${employee.firstName} ${employee.lastName} (${employee.employeeCode}).`,
          },
        });
      }

      // 3. Create Notification for allocated employee
      if (employee && employee.userId) {
        await tx.notification.create({
          data: {
            customerId: numCustomerId,
            userId: employee.userId,
            title: `[${dto.priority}] New Task Allocated`,
            message: `You have been allocated ${dto.priority} priority task: "${task.title}". Due: ${dto.dueDate} ${dto.dueTime}.`,
            type: 'TASK_ALLOCATED',
            data: { taskId: task.id, taskNumber: task.taskNumber, priority: dto.priority },
          },
        });
      }

      return task;
    });

    if (task.employeeId) {
      const assignedBy = task.createdBy
        ? `${task.createdBy.firstName || ''} ${task.createdBy.lastName || ''}`.trim()
        : 'QB Suite';
      this.employeeCommunication?.notifyTaskAssigned({
        employeeId: task.employeeId,
        taskId: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: task.dueDate,
        assignedBy: assignedBy || 'QB Suite',
        status: task.status,
      }).catch((err: any) => this.logger.warn(`[TASK_ASSIGNED] ${err?.message}`));
    }

    return task;
  }

  async findAll(
    customerId: number | string | undefined,
    query: {
      status?: string;
      employeeId?: string;
      departmentId?: string;
      priority?: string;
      search?: string;
      isOverdue?: string;
      sortBy?: 'priority' | 'dueDate' | 'createdAt';
      page?: number;
      limit?: number;
    },
  ) {
    const numCustomerId = Number(customerId);
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    if (query.status && query.status !== 'ALL') {
      if (query.status === 'UNDER_REVIEW') {
        where.status = { in: [TaskStatus.SUBMITTED, TaskStatus.UNDER_REVIEW] };
      } else {
        where.status = query.status as TaskStatus;
      }
    }

    if (query.employeeId && query.employeeId !== 'ALL') {
      where.employeeId = Number(query.employeeId);
    }

    if (query.departmentId && query.departmentId !== 'ALL') {
      where.departmentId = Number(query.departmentId);
    }

    if (query.priority && query.priority !== 'ALL') {
      where.priority = query.priority as TaskPriority;
    }

    if (query.isOverdue === 'true') {
      where.status = { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] };
      where.dueAt = { lt: new Date() };
    }

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { taskNumber: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { employee: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { employee: { lastName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    let orderBy: any = { createdAt: 'desc' };
    if (query.sortBy === 'dueDate') {
      orderBy = { dueAt: 'asc' };
    }

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { id: true, name: true } },
              designation: { select: { id: true, name: true } },
            },
          },
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          proofs: { take: 1, orderBy: { uploadedAt: 'desc' } },
        },
      }),
      this.prisma.task.count({ where }),
    ]);

    const now = new Date();
    const mapped = tasks.map((t) => ({
      ...t,
      isOverdue: t.dueAt && t.dueAt < now && t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.CANCELLED,
      hasProof: t.proofs && t.proofs.length > 0,
    }));

    if (query.sortBy === 'priority' || !query.sortBy) {
      const priorityOrder: Record<string, number> = {
        [TaskPriority.URGENT]: 1,
        [TaskPriority.HIGH]: 2,
        [TaskPriority.MEDIUM]: 3,
        [TaskPriority.LOW]: 4,
      };

      mapped.sort((a, b) => {
        const pA = priorityOrder[a.priority] || 99;
        const pB = priorityOrder[b.priority] || 99;
        if (pA !== pB) return pA - pB;

        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;

        const timeA = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
        const timeB = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
        return timeA - timeB;
      });
    }

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: mapped,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
      },
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async findOne(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const where: any = { id: numId, deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const task = await this.prisma.task.findFirst({
      where,
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
        department: true,
        designation: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        proofs: { orderBy: { uploadedAt: 'desc' } },
        reviews: { orderBy: { reviewedAt: 'desc' } },
        history: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    const now = new Date();
    return {
      ...task,
      isOverdue: task.dueAt && task.dueAt < now && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELLED,
    };
  }

  async update(customerId: number | string, id: number | string, dto: UpdateTaskDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const existing = await this.findOne(numCustomerId, numId);

    const { dueDate, dueAt } = this.parseDueDateTime(
      dto.dueDate || (existing.dueDate ? existing.dueDate.toISOString().split('T')[0] : undefined),
      dto.dueTime || existing.dueTime || undefined,
    );

    const updated = await this.prisma.task.update({
      where: { id: numId },
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        employeeId: dto.employeeId ? Number(dto.employeeId) : undefined,
        departmentId: dto.departmentId ? Number(dto.departmentId) : undefined,
        designationId: dto.designationId ? Number(dto.designationId) : undefined,
        dueDate,
        dueTime: dto.dueTime,
        dueAt,
        notes: dto.notes,
      },
      include: {
        employee: true,
        department: true,
        designation: true,
      },
    });

    return updated;
  }

  async reallocate(customerId: number | string, id: number | string, performedById: number | string, dto: ReallocateTaskDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const task = await this.findOne(numCustomerId, numId);

    const newEmployeeId = Number(dto.employeeId);
    const newEmployee = await this.prisma.employee.findUnique({
      where: { id: newEmployeeId },
      include: { department: true, designation: true },
    });

    if (!newEmployee || newEmployee.status === 'INACTIVE') {
      throw new NotFoundException('Selected employee does not exist or is inactive');
    }

    const prevEmployeeName = task.employee ? `${task.employee.firstName} ${task.employee.lastName}` : 'Unassigned';
    const newEmployeeName = `${newEmployee.firstName} ${newEmployee.lastName}`;

    const updatedTask = await this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: numId },
        data: {
          employeeId: newEmployeeId,
          assignedToId: newEmployee.userId || null,
          departmentId: newEmployee.departmentId || task.departmentId,
          designationId: newEmployee.designationId || task.designationId,
        },
        include: {
          employee: true,
          department: true,
          designation: true,
        },
      });

      // Record reallocation history
      await tx.taskHistory.create({
        data: {
          taskId: numId,
          action: 'TASK_REALLOCATED',
          performedById: Number(performedById),
          performedByName: 'HR Administrator',
          previousEmployeeId: task.employeeId,
          previousEmployeeName: prevEmployeeName,
          newEmployeeId: newEmployee.id,
          newEmployeeName: newEmployeeName,
          comment: dto.reason ? `Reallocated: ${dto.reason}` : `Reallocated from ${prevEmployeeName} to ${newEmployeeName}`,
        },
      });

      // Notify new employee
      if (newEmployee.userId) {
        await tx.notification.create({
          data: {
            customerId: numCustomerId,
            userId: newEmployee.userId,
            title: `[${task.priority}] Task Reallocated to You`,
            message: `Task "${task.title}" has been reallocated to you. Due: ${task.dueTime || ''} ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : ''}.`,
            type: 'TASK_REALLOCATED',
            data: { taskId: task.id, priority: task.priority },
          },
        });
      }

      return updatedTask;
    });

    this.employeeCommunication?.notifyTaskAssigned({
      employeeId: newEmployee.id,
      taskId: updatedTask.id,
      title: task.title,
      description: task.description,
      priority: String(task.priority),
      dueDate: task.dueDate,
      assignedBy: 'QB Suite',
      status: updatedTask.status,
    }).catch((err: any) => this.logger.warn(`[TASK_ASSIGNED] ${err?.message}`));

    return updatedTask;
  }

  async startTask(customerId: number | string, id: number | string, performedById: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const task = await this.findOne(numCustomerId, numId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: numId },
        data: { status: TaskStatus.IN_PROGRESS, startedAt: new Date() },
      });

      await tx.taskHistory.create({
        data: {
          taskId: numId,
          action: 'TASK_STARTED',
          performedById: Number(performedById),
          performedByName: task.employee ? `${task.employee.firstName} ${task.employee.lastName}` : 'Employee',
          oldStatus: task.status,
          newStatus: 'IN_PROGRESS',
          comment: 'Employee commenced work on task.',
        },
      });

      return updated;
    });
  }

  async submitProof(customerId: number | string, id: number | string, employeeId: number | string, dto: SubmitTaskProofDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const task = await this.findOne(numCustomerId, numId);

    if (!dto.fileUrl || !dto.fileUrl.trim()) {
      throw new BadRequestException('Completion proof photo is required. You cannot submit without uploading photo proof.');
    }

    return this.prisma.$transaction(async (tx) => {
      const proof = await tx.taskProof.create({
        data: {
          taskId: numId,
          employeeId: Number(employeeId) || task.employeeId,
          fileUrl: dto.fileUrl.trim(),
          fileName: dto.fileName || 'completion_proof.jpg',
          fileType: dto.fileType || 'image/jpeg',
          fileSize: dto.fileSize,
          comment: dto.comment,
        },
      });

      const updatedTask = await tx.task.update({
        where: { id: numId },
        data: {
          status: TaskStatus.UNDER_REVIEW,
          submittedAt: new Date(),
          submissionComment: dto.comment,
        },
        include: { proofs: true, employee: true },
      });

      await tx.taskHistory.create({
        data: {
          taskId: numId,
          action: 'PROOF_SUBMITTED',
          performedById: Number(employeeId),
          performedByName: task.employee ? `${task.employee.firstName} ${task.employee.lastName}` : 'Employee',
          oldStatus: task.status,
          newStatus: 'UNDER_REVIEW',
          comment: dto.comment ? `Proof submitted: "${dto.comment}"` : 'Photo proof uploaded and submitted for HR review.',
        },
      });

      return updatedTask;
    });
  }

  // ============================================================
  // EMPLOYEE MOBILE API METHODS (STRICT OWNERSHIP ENFORCEMENT)
  // ============================================================

  async getMyTasks(user: any, customerId: number | string | undefined, query: { status?: string; priority?: string; search?: string }) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const { orOwnership, teamIds } = await this.buildMyTaskOwnership(employee);

    const where: any = {
      OR: orOwnership,
      deletedAt: null,
    };

    if (query.status && query.status !== 'ALL') {
      if (query.status === 'UNDER_REVIEW') {
        where.status = { in: [TaskStatus.SUBMITTED, TaskStatus.UNDER_REVIEW] };
      } else {
        where.status = query.status as TaskStatus;
      }
    }

    if (query.priority && query.priority !== 'ALL') {
      where.priority = query.priority as TaskPriority;
    }

    if (query.search) {
      const searchCond = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { taskNumber: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { companyName: { contains: query.search, mode: 'insensitive' } } },
      ];
      where.AND = [{ OR: searchCond }];
    }

    const tasks = await this.prisma.task.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            companyName: true,
            phone: true,
            email: true,
            city: true,
            address: true,
            isActive: true,
            customerType: true,
          },
        },
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            designation: { select: { id: true, name: true } },
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        proofs: { orderBy: { uploadedAt: 'desc' } },
      },
    });

    const now = new Date();
    const hrTasks = tasks.map((t) => ({
      ...t,
      source: 'TASK',
      isOverdue: t.dueAt && t.dueAt < now && t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.CANCELLED,
      hasProof: t.proofs && t.proofs.length > 0,
    }));

    const works: any[] = await this.findMyProductionWorks(
      employee.id,
      employee.userId,
      employee.customerId,
      teamIds,
      query,
    );
    const calendarWorks = await this.findEmployeeCalendarWorks(employee.id, employee.customerId, teamIds, query);
    const seenWorkIds = new Set(works.map((work) => work.id));
    const assignmentWorks = works.length;
    for (const calendarWork of calendarWorks) {
      if (!seenWorkIds.has(calendarWork.id)) {
        works.push(calendarWork);
        seenWorkIds.add(calendarWork.id);
      }
    }
    const combined = [...hrTasks, ...works];
    const baseTaskCount = await this.prisma.work.count({
      where: { status: { not: WorkStatus.CANCELLED } },
    });
    this.logger.log(
      `[MOBILE_TASKS_DEBUG] currentEmployeeId=${employee.id} currentTeamId=${teamIds.join(',') || 'none'} tenantCustomerId=${employee.customerId ?? 'none'} baseTaskCount=${baseTaskCount} calendarTaskCount=${calendarWorks.length} mobileTaskQueryCount=${assignmentWorks} finalTaskCount=${combined.length} status=${query.status || 'ALL'}`,
    );
    return combined;
  }

  private productionWorkMatchesStatus(status: string, filter?: string) {
    if (!filter || filter === 'ALL') return status !== WorkStatus.CANCELLED;
    if (filter === 'PENDING') {
      return status === WorkStatus.SCHEDULED || status === WorkStatus.ASSIGNED || status === WorkStatus.BLOCKED;
    }
    if (filter === 'IN_PROGRESS') {
      return status === WorkStatus.IN_PROGRESS || status === WorkStatus.PROCESSING;
    }
    if (filter === 'UNDER_REVIEW') {
      return (
        status === WorkStatus.SUBMITTED ||
        status === WorkStatus.UNDER_REVIEW ||
        status === WorkStatus.CUSTOMER_REVIEW ||
        status === WorkStatus.REVISION_REQUESTED
      );
    }
    if (filter === 'COMPLETED') {
      return status === WorkStatus.COMPLETED || status === WorkStatus.APPROVED;
    }
    return status === filter;
  }

  private isBpoTeamLabel(name?: string | null, description?: string | null) {
    const label = `${name || ''} ${description || ''}`.toUpperCase();
    return label.includes('BPO') && !label.includes('PRODUCTION');
  }

  private async employeeOnBpoTeam(teamIds: number[]) {
    if (teamIds.length === 0) return false;
    const teams = await this.prisma.team.findMany({
      where: { id: { in: teamIds }, isActive: true },
      select: { name: true, description: true },
    });
    return teams.some((team) => this.isBpoTeamLabel(team.name, team.description));
  }

  /** Production members see the calendar work set. Work that belongs only to a BPO team stays with BPO. Direct assignment is always visible. */
  private productionViewerMaySeeWork(
    work: any,
    employeeId: number,
    assigneeIds: number[],
    productionTeamIds: number[],
    viewerOnBpo: boolean,
  ) {
    if (assigneeIds.includes(Number(work.assignedToId)) || Number(work.editorId) === employeeId) {
      return true;
    }
    const workTeamBpo = this.isBpoTeamLabel(work.team?.name, work.team?.description);
    const customerTeamBpo = this.isBpoTeamLabel(
      work.customer?.assignedTeam?.name,
      work.customer?.assignedTeam?.description,
    );
    const assigneeTeams = (work.assignedTo?.teamMembers || []).map((member: any) => member.team).filter(Boolean);
    const assigneeIsBpoOnly =
      assigneeTeams.length > 0 && assigneeTeams.every((team: any) => this.isBpoTeamLabel(team.name, team.description));
    if ((workTeamBpo || customerTeamBpo || assigneeIsBpoOnly) && !viewerOnBpo) return false;
    if (productionTeamIds.length === 0) return true;
    if (workTeamBpo || customerTeamBpo || assigneeIsBpoOnly) return viewerOnBpo;
    return true;
  }

  /**
   * Same Work rows as GET /works/employee/calendar.
   * A BPO-only employee does not receive that full calendar set.
   */
  private async findEmployeeCalendarWorks(
    employeeId: number,
    agencyCustomerId: number | null | undefined,
    teamIds: number[],
    query: { status?: string; priority?: string; search?: string },
  ) {
    const productionTeamIds = await this.productionTeamIdsForEmployee(0, teamIds);
    const onBpoTeam = await this.employeeOnBpoTeam(teamIds);
    const bpoOnly = onBpoTeam && productionTeamIds.length === 0;
    if (bpoOnly || (query.priority && query.priority !== 'ALL')) return [];

    const companyId = Number(agencyCustomerId);
    if (!Number.isInteger(companyId) || companyId <= 0) return [];

    let items: any[] = [];
    try {
      items = await this.prisma.work.findMany({
        where: {
          status: { not: WorkStatus.CANCELLED },
          OR: [
            {
              customer: {
                deletedAt: null,
                isActive: true,
                OR: [
                  { id: companyId },
                  { assignedTeam: { customerId: companyId } },
                  { assignedEmployeeRel: { customerId: companyId } },
                  { createdByEmployeeRel: { customerId: companyId } },
                ],
              },
            },
            { assignedTo: { customerId: companyId } },
            { editor: { customerId: companyId } },
            { team: { customerId: companyId } },
          ],
        },
        orderBy: { scheduledDate: 'asc' },
        include: {
          customer: { select: { id: true, name: true, companyName: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          editor: { select: { id: true, firstName: true, lastName: true } },
          team: { select: { id: true, name: true, description: true } },
        },
      });
    } catch (error: any) {
      this.logger.warn(`Employee calendar work lookup failed: ${error?.message}`);
      return [];
    }

    const search = query.search?.trim().toLowerCase();
    return items
      .filter((item) => this.productionWorkMatchesStatus(String(item?.status || ''), query.status))
      .filter((item) => {
        if (Number(item.assignedToId) === employeeId || Number(item.editorId) === employeeId) return true;
        return !this.isBpoTeamLabel(item?.team?.name, item?.team?.description);
      })
      .filter((item) => {
        if (!search) return true;
        const title = String(item?.title || '').toLowerCase();
        const description = String(item?.description || '').toLowerCase();
        const customerName = String(item?.customer?.name || '').toLowerCase();
        const companyName = String(item?.customer?.companyName || '').toLowerCase();
        return (
          title.includes(search) ||
          description.includes(search) ||
          customerName.includes(search) ||
          companyName.includes(search)
        );
      })
      .map((item) => {
        const id = Number(item.id);
        const customerId = Number(item.customerId);
        const assigned = item.assignedTo || item.editor;
        const firstName = assigned?.firstName || '';
        const lastName = assigned?.lastName || '';
        return {
          id,
          source: 'WORK',
          customerId: Number.isInteger(customerId) && customerId > 0 ? customerId : null,
          customer:
            Number.isInteger(customerId) && customerId > 0
              ? {
                  id: customerId,
                  name: item.customer?.name || item.customer?.companyName || `Customer #${customerId}`,
                  companyName: item.customer?.companyName || null,
                }
              : null,
          title: item.title,
          description: item.description || null,
          status: item.status,
          priority: item.priority || null,
          dueAt: item.scheduledDate || null,
          dueDate: item.scheduledDate || null,
          scheduledDate: item.scheduledDate || null,
          scheduledTime: item.scheduledTime || null,
          workType: item.workType || null,
          taskNumber: `WRK-${id}`,
          employee: assigned
            ? { id: assigned.id, firstName, lastName }
            : null,
          assignedTo: null,
          team: item.team ? { id: item.team.id, name: item.team.name } : null,
          proofs: [],
          hasProof: false,
          isOverdue: false,
        };
      })
      .filter((work) => Number.isInteger(work.id) && work.id > 0);
  }

  private async productionTeamIdsForEmployee(_agencyCustomerId: number, teamIds: number[]) {
    if (teamIds.length === 0) return [];
    const teams = await this.prisma.team.findMany({
      where: {
        id: { in: teamIds },
        isActive: true,
        OR: [
          { name: { contains: 'PRODUCTION', mode: 'insensitive' } },
          { description: { contains: 'PRODUCTION', mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, description: true },
    });
    return teams
      .filter((team) => {
        const label = `${team.name || ''} ${team.description || ''}`.toUpperCase();
        return label.includes('PRODUCTION') && !label.includes('BPO');
      })
      .map((team) => team.id);
  }

  private async findMyProductionWorks(
    employeeId: number,
    userId: number | null | undefined,
    agencyCustomerId: number,
    teamIds: number[],
    query: { status?: string; priority?: string; search?: string },
  ) {
    const productionTeamIds = await this.productionTeamIdsForEmployee(agencyCustomerId, teamIds);
    const assigneeIds = Array.from(
      new Set(
        [employeeId, userId]
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    );
    const workOr: any[] = [
      { assignedToId: { in: assigneeIds } },
      { editorId: employeeId },
      { tasks: { some: { assignedToId: { in: assigneeIds } } } },
      // Customer calendar shows every work for a customer. An employee authorized
      // for that customer (direct assignment or their team) sees those same works.
      { customer: { assignedEmployeeId: employeeId } },
    ];
    if (teamIds.length > 0) {
      workOr.push({ teamId: { in: teamIds } });
      workOr.push({ customer: { assignedTeamId: { in: teamIds } } });
    }
    const onBpoTeam = await this.employeeOnBpoTeam(teamIds);
    const bpoOnly = onBpoTeam && productionTeamIds.length === 0;
    // Customer Calendar stores Work on the client customer, not on the employer id.
    // A non-BPO employee sees those works when the client is linked to their company.
    if (!bpoOnly && agencyCustomerId) {
      const companyCustomer = {
        deletedAt: null,
        isActive: true,
        OR: [
          { id: agencyCustomerId },
          { assignedTeam: { customerId: agencyCustomerId } },
          { assignedEmployeeRel: { customerId: agencyCustomerId } },
          { createdByEmployeeRel: { customerId: agencyCustomerId } },
        ],
      };
      workOr.push(
        { customer: companyCustomer },
        { assignedTo: { customerId: agencyCustomerId } },
        { editor: { customerId: agencyCustomerId } },
        { team: { customerId: agencyCustomerId } },
      );
    }
    if (productionTeamIds.length > 0) {
      const onProductionTeam = {
        OR: [
          { teamMembers: { some: { teamId: { in: productionTeamIds } } } },
          { ledTeams: { some: { id: { in: productionTeamIds } } } },
        ],
      };
      workOr.push({ customer: { assignedTeamId: { in: productionTeamIds } } });
      workOr.push({ assignedTo: onProductionTeam });
      workOr.push({ editor: onProductionTeam });
    }

    const works = await this.prisma.work.findMany({
      where: {
        status: { not: WorkStatus.CANCELLED },
        OR: workOr,
      },
      orderBy: { scheduledDate: 'asc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            companyName: true,
            phone: true,
            email: true,
            city: true,
            address: true,
            isActive: true,
            customerType: true,
            assignedTeam: { select: { id: true, name: true, description: true } },
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            designation: { select: { id: true, name: true } },
            teamMembers: { select: { team: { select: { id: true, name: true, description: true } } } },
          },
        },
        team: { select: { id: true, name: true, description: true } },
      },
    });

    const viewerOnBpo = await this.employeeOnBpoTeam(teamIds);
    const search = query.search?.trim().toLowerCase();
    return works
      .filter((work) =>
        this.productionViewerMaySeeWork(work, employeeId, assigneeIds, productionTeamIds, viewerOnBpo),
      )
      .filter((work) => this.productionWorkMatchesStatus(work.status, query.status))
      .filter((work) => {
        if (query.priority && query.priority !== 'ALL' && String(work.priority) !== query.priority) {
          return false;
        }
        if (!search) return true;
        const title = (work.title || '').toLowerCase();
        const description = (work.description || '').toLowerCase();
        const customerName = (work.customer?.name || '').toLowerCase();
        const companyName = (work.customer?.companyName || '').toLowerCase();
        return (
          title.includes(search) ||
          description.includes(search) ||
          customerName.includes(search) ||
          companyName.includes(search)
        );
      })
      .map((work) => ({
        id: work.id,
        source: 'WORK',
        customerId: work.customerId,
        customer: work.customer
          ? {
              id: work.customer.id,
              name: work.customer.name,
              companyName: work.customer.companyName,
              phone: work.customer.phone,
              email: work.customer.email,
              city: work.customer.city,
              address: work.customer.address,
              isActive: work.customer.isActive,
              customerType: work.customer.customerType,
            }
          : null,
        title: work.title,
        description: work.description,
        status: work.status,
        priority: work.priority,
        dueAt: work.scheduledDate,
        dueDate: work.scheduledDate,
        scheduledDate: work.scheduledDate,
        scheduledTime: work.scheduledTime,
        workType: work.workType,
        taskNumber: `WRK-${work.id}`,
        employee: work.assignedTo
          ? {
              id: work.assignedTo.id,
              firstName: work.assignedTo.firstName,
              lastName: work.assignedTo.lastName,
              employeeCode: work.assignedTo.employeeCode,
              designation: work.assignedTo.designation,
            }
          : null,
        assignedTo: null,
        team: work.team
          ? { id: work.team.id, name: work.team.name }
          : work.customer?.assignedTeam
            ? { id: work.customer.assignedTeam.id, name: work.customer.assignedTeam.name }
            : null,
        proofs: [],
        hasProof: false,
        isOverdue: false,
      }));
  }

  async getMyTask(user: any, customerId: number | string | undefined, id: number | string) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const numId = Number(id);

    const { orOwnership } = await this.buildMyTaskOwnership(employee);

    const task = await this.prisma.task.findFirst({
      where: {
        id: numId,
        OR: orOwnership,
        deletedAt: null,
      },
      include: {
        customer: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            designation: { select: { id: true, name: true } },
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        department: true,
        designation: true,
        proofs: { orderBy: { uploadedAt: 'desc' } },
        reviews: { orderBy: { reviewedAt: 'desc' } },
        history: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task #${id} not found or you do not have permission to view it`);
    }

    const now = new Date();
    return {
      ...task,
      isOverdue: task.dueAt && task.dueAt < now && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELLED,
    };
  }

  async startMyTask(user: any, customerId: number | string | undefined, id: number | string) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const task = await this.getMyTask(user, customerId, id);

    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      throw new BadRequestException(`Cannot start a task that is already ${task.status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.IN_PROGRESS,
          startedAt: new Date(),
        },
      });

      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          action: 'TASK_STARTED',
          performedById: employee.id,
          performedByName: `${employee.firstName} ${employee.lastName}`,
          oldStatus: task.status,
          newStatus: 'IN_PROGRESS',
          comment: 'Employee commenced work on task via mobile app.',
        },
      });

      return updated;
    });
  }

  async submitMyTaskProof(user: any, customerId: number | string | undefined, id: number | string, dto: SubmitTaskProofDto) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const task = await this.getMyTask(user, customerId, id);

    if (!dto.fileUrl || !dto.fileUrl.trim()) {
      throw new BadRequestException('Completion proof photo is required.');
    }

    return this.prisma.$transaction(async (tx) => {
      const proof = await tx.taskProof.create({
        data: {
          taskId: task.id,
          employeeId: employee.id,
          fileUrl: dto.fileUrl.trim(),
          fileName: dto.fileName || 'mobile_completion_proof.jpg',
          fileType: dto.fileType || 'image/jpeg',
          fileSize: dto.fileSize,
          comment: dto.comment,
        },
      });

      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.UNDER_REVIEW,
          submittedAt: new Date(),
          submissionComment: dto.comment,
        },
        include: { proofs: true },
      });

      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          action: 'PROOF_SUBMITTED',
          performedById: employee.id,
          performedByName: `${employee.firstName} ${employee.lastName}`,
          oldStatus: task.status,
          newStatus: 'UNDER_REVIEW',
          comment: dto.comment ? `Proof attached: "${dto.comment}"` : 'Photo proof uploaded and submitted for HR review.',
        },
      });

      return updatedTask;
    });
  }

  async submitMyTask(user: any, customerId: number | string | undefined, id: number | string, comment?: string) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const task = await this.getMyTask(user, customerId, id);

    // CRITICAL: Verify at least one proof photo exists
    const proofCount = await this.prisma.taskProof.count({
      where: { taskId: task.id },
    });

    if (proofCount === 0) {
      throw new BadRequestException('Completion proof photo is required. You cannot submit without uploading photo proof.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.UNDER_REVIEW,
          submittedAt: new Date(),
          submissionComment: comment || task.submissionComment,
        },
      });

      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          action: 'TASK_SUBMITTED',
          performedById: employee.id,
          performedByName: `${employee.firstName} ${employee.lastName}`,
          oldStatus: task.status,
          newStatus: 'UNDER_REVIEW',
          comment: comment ? `Submitted for HR review: "${comment}"` : 'Task submitted for HR verification.',
        },
      });

      return updatedTask;
    });
  }

  // ============================================================
  // HR APPROVE / REJECT METHODS
  // ============================================================

  async approveTask(customerId: number | string, id: number | string, reviewedById: number | string, dto: ReviewTaskDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const task = await this.findOne(numCustomerId, numId);

    return this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: numId },
        data: {
          status: TaskStatus.COMPLETED,
          completedAt: new Date(),
          approvedById: Number(reviewedById),
          approvedByName: 'HR Administrator',
          approvedAt: new Date(),
        },
        include: { employee: true, proofs: true },
      });

      // Create TaskReview
      await tx.taskReview.create({
        data: {
          taskId: numId,
          reviewedById: Number(reviewedById),
          reviewedByName: 'HR Administrator',
          status: 'APPROVED',
          comment: dto.comment || 'Proof verified and approved by HR.',
        },
      });

      // Create Audit History
      await tx.taskHistory.create({
        data: {
          taskId: numId,
          action: 'TASK_APPROVED',
          performedById: Number(reviewedById),
          performedByName: 'HR Administrator',
          oldStatus: task.status,
          newStatus: 'COMPLETED',
          comment: dto.comment ? `Approved: ${dto.comment}` : 'Task proof approved. Task marked as COMPLETED.',
        },
      });

      // Notify employee
      if (task.employee && task.employee.userId) {
        await tx.notification.create({
          data: {
            customerId: numCustomerId,
            userId: task.employee.userId,
            title: `Task Approved! 🎉`,
            message: `Your task "${task.title}" has been approved and marked COMPLETED by HR.`,
            type: 'TASK_APPROVED',
            data: { taskId: task.id },
          },
        });
      }

      return updatedTask;
    });
  }

  async rejectTask(customerId: number | string, id: number | string, reviewedById: number | string, dto: ReviewTaskDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const task = await this.findOne(numCustomerId, numId);

    const reason = (dto.rejectionReason || dto.comment || '').trim();
    if (!reason) {
      throw new BadRequestException('Rejection reason is mandatory when rejecting task proof.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: numId },
        data: {
          status: TaskStatus.REJECTED,
          rejectedById: Number(reviewedById),
          rejectedByName: 'HR Administrator',
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
        include: { employee: true, proofs: true },
      });

      // Create TaskReview
      await tx.taskReview.create({
        data: {
          taskId: numId,
          reviewedById: Number(reviewedById),
          reviewedByName: 'HR Administrator',
          status: 'REJECTED',
          comment: reason,
        },
      });

      // Create Audit History
      await tx.taskHistory.create({
        data: {
          taskId: numId,
          action: 'TASK_REJECTED',
          performedById: Number(reviewedById),
          performedByName: 'HR Administrator',
          oldStatus: task.status,
          newStatus: 'REJECTED',
          comment: `Task proof rejected with reason: "${reason}". Task reopened for corrections.`,
        },
      });

      // Notify employee
      if (task.employee && task.employee.userId) {
        await tx.notification.create({
          data: {
            customerId: numCustomerId,
            userId: task.employee.userId,
            title: 'Task Proof Rejected',
            message: `Your task "${task.title}" proof was rejected by HR: "${reason}". Please upload clear proof and resubmit.`,
            type: 'TASK_REJECTED',
            data: { taskId: task.id, reason },
          },
        });
      }

      return updatedTask;
    });
  }

  async getHistory(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.taskHistory.findMany({
      where: { taskId: numId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.task.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });
  }
}
