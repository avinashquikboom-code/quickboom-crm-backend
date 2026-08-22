import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  ReallocateTaskDto,
  SubmitTaskProofDto,
  ReviewTaskDto,
} from './dto/task.dto';
import { TaskPriority, TaskStatus } from '@prisma/client';

@Injectable()
export class TaskService {
  constructor(private prisma: PrismaService) {}

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

  public async getAuthenticatedEmployee(user: any, customerId?: number | string) {
    if (!user) {
      throw new ForbiddenException('Authenticated user context required');
    }

    let employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user.id },
          { email: { equals: user.email?.trim().toLowerCase(), mode: 'insensitive' } },
        ],
      },
      include: {
        office: true,
        department: true,
        designation: true,
      },
    });

    if (!employee && customerId) {
      const numCustomerId = Number(customerId);
      if (!isNaN(numCustomerId)) {
        employee = await this.prisma.employee.findFirst({
          where: { customerId: numCustomerId, status: 'ACTIVE' },
          include: { office: true, department: true, designation: true },
        });
      }
    }

    if (!employee) {
      throw new ForbiddenException('No active employee record linked to current user account');
    }

    return employee;
  }

  async getMetrics(customerId: number | string) {
    const numCustomerId = Number(customerId);
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
      this.prisma.task.count({ where: { customerId: numCustomerId, deletedAt: null } }),
      this.prisma.task.count({ where: { customerId: numCustomerId, status: TaskStatus.PENDING, deletedAt: null } }),
      this.prisma.task.count({ where: { customerId: numCustomerId, status: TaskStatus.IN_PROGRESS, deletedAt: null } }),
      this.prisma.task.count({
        where: {
          customerId: numCustomerId,
          status: { in: [TaskStatus.SUBMITTED, TaskStatus.UNDER_REVIEW] },
          deletedAt: null,
        },
      }),
      this.prisma.task.count({ where: { customerId: numCustomerId, status: TaskStatus.COMPLETED, deletedAt: null } }),
      this.prisma.task.count({ where: { customerId: numCustomerId, status: TaskStatus.REJECTED, deletedAt: null } }),
      this.prisma.task.count({ where: { customerId: numCustomerId, priority: TaskPriority.URGENT, deletedAt: null } }),
      this.prisma.task.count({ where: { customerId: numCustomerId, priority: TaskPriority.HIGH, deletedAt: null } }),
      this.prisma.task.count({ where: { customerId: numCustomerId, priority: TaskPriority.MEDIUM, deletedAt: null } }),
      this.prisma.task.count({ where: { customerId: numCustomerId, priority: TaskPriority.LOW, deletedAt: null } }),
      this.prisma.task.findMany({
        where: {
          customerId: numCustomerId,
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
    return this.prisma.$transaction(async (tx) => {
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
          assignedToId: dto.assignedToId ? Number(dto.assignedToId) : undefined,
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
  }

  async findAll(
    customerId: number | string,
    query: {
      status?: string;
      employeeId?: string;
      departmentId?: string;
      priority?: string;
      search?: string;
      isOverdue?: string;
      sortBy?: 'priority' | 'dueDate' | 'createdAt';
    },
  ) {
    const numCustomerId = Number(customerId);
    const where: any = { customerId: numCustomerId, deletedAt: null };

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

    const tasks = await this.prisma.task.findMany({
      where,
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
    });

    const now = new Date();
    const mapped = tasks.map((t) => ({
      ...t,
      isOverdue: t.dueAt && t.dueAt < now && t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.CANCELLED,
      hasProof: t.proofs && t.proofs.length > 0,
    }));

    // If sorting by priority: URGENT -> HIGH -> MEDIUM -> LOW, then overdue first, then nearest due date
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

        // Same priority: overdue first
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;

        // Then nearest due date
        const timeA = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
        const timeB = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
        return timeA - timeB;
      });
    }

    return mapped;
  }

  async findOne(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const task = await this.prisma.task.findFirst({
      where: { id: numId, customerId: numCustomerId, deletedAt: null },
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

    return this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: numId },
        data: {
          employeeId: newEmployeeId,
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

    const where: any = {
      customerId: employee.customerId,
      employeeId: employee.id,
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
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { taskNumber: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const tasks = await this.prisma.task.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      include: {
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        proofs: { orderBy: { uploadedAt: 'desc' } },
      },
    });

    const now = new Date();
    return tasks.map((t) => ({
      ...t,
      isOverdue: t.dueAt && t.dueAt < now && t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.CANCELLED,
      hasProof: t.proofs && t.proofs.length > 0,
    }));
  }

  async getMyTask(user: any, customerId: number | string | undefined, id: number | string) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const numId = Number(id);

    const task = await this.prisma.task.findFirst({
      where: {
        id: numId,
        customerId: employee.customerId,
        employeeId: employee.id,
        deletedAt: null,
      },
      include: {
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
