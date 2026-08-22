import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkDto, UpdateWorkDto } from './dto/work.dto';
import { WorkType, WorkStatus, TaskStatus } from '@prisma/client';

import { PlanAccessService } from '../subscription/plan-access.service';

@Injectable()
export class WorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planAccessService?: PlanAccessService,
  ) {}

  async findAll(customerId: number | string, status?: WorkStatus, workType?: WorkType, page = 1, limit = 50) {
    const numCustomerId = Number(customerId);
    const skip = (page - 1) * limit;
    const where: any = { customerId: numCustomerId };

    if (status) where.status = status;
    if (workType) where.workType = workType;

    const [items, total] = await Promise.all([
      this.prisma.work.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledDate: 'desc' },
        include: {
          team: true,
          assignedTo: true,
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
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const work = await this.prisma.work.findFirst({
      where: { id: numId, customerId: numCustomerId },
      include: {
        team: true,
        assignedTo: true,
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
      throw new NotFoundException(`Work with ID ${id} not found`);
    }

    return work;
  }

  async create(customerId: number | string, dto: CreateWorkDto) {
    const numCustomerId = Number(customerId);
    // 1. Verify Customer & Active Subscription
    const subscription = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId, status: 'ACTIVE' },
      include: { plan: true },
    });

    if (!subscription) {
      throw new BadRequestException('No active subscription found for this customer.');
    }

    const serviceName = dto.serviceName || (dto.workType === WorkType.REELS_SHOOT ? 'Reels' : 'Creative Posts');

    if (this.planAccessService) {
      await this.planAccessService.checkScheduleAccess(numCustomerId, serviceName);
    }

    // 2. Entitlement verification
    let entitlement = await this.prisma.planEntitlement.findFirst({
      where: { customerId: numCustomerId, serviceName },
    });

    if (!entitlement) {
      const defaultQty = serviceName === 'Reels' ? 4 : 8;
      entitlement = await this.prisma.planEntitlement.create({
        data: {
          customerId: numCustomerId,
          planId: subscription.planId,
          serviceName,
          totalQty: defaultQty,
          usedQty: 0,
          scheduledQty: 0,
        },
      });
    }

    const remaining = entitlement.totalQty - (entitlement.usedQty + entitlement.scheduledQty);
    if (remaining <= 0) {
      throw new BadRequestException(`Plan limit reached for this service (${serviceName}). Remaining: 0.`);
    }

    // 3. Create ONE Work record & increment scheduledQty on entitlement
    return this.prisma.$transaction(async (tx) => {
      await tx.planEntitlement.update({
        where: { id: entitlement.id },
        data: { scheduledQty: { increment: 1 } },
      });

      const work = await tx.work.create({
        data: {
          customerId: numCustomerId,
          planId: subscription.planId,
          entitlementId: entitlement.id,
          teamId: dto.teamId ? Number(dto.teamId) : null,
          assignedToId: dto.assignedToId ? Number(dto.assignedToId) : null,
          workType: dto.workType,
          title: dto.title,
          description: dto.description,
          scheduledDate: new Date(dto.scheduledDate),
          scheduledTime: dto.scheduledTime || '10:00 AM',
          priority: dto.priority || 'MEDIUM',
          status: WorkStatus.SCHEDULED,
        },
      });

      // 4. Auto-create internal multi-step workflow tasks without consuming extra plan units
      if (dto.workType === WorkType.REELS_SHOOT) {
        await tx.workTask.createMany({
          data: [
            { workId: work.id, title: 'Reels Video Shoot', stepOrder: 1, status: TaskStatus.PENDING },
            { workId: work.id, title: 'Video Editing & Color Grading', stepOrder: 2, status: TaskStatus.PENDING },
            { workId: work.id, title: 'Creative Review & Approval', stepOrder: 3, status: TaskStatus.PENDING },
            { workId: work.id, title: 'Social Media Upload & Tagging', stepOrder: 4, status: TaskStatus.PENDING },
          ],
        });
      } else if (dto.workType === WorkType.POST_DESIGN) {
        await tx.workTask.createMany({
          data: [
            { workId: work.id, title: 'Graphic Post Design', stepOrder: 1, status: TaskStatus.PENDING },
            { workId: work.id, title: 'Caption & Copywriting', stepOrder: 2, status: TaskStatus.PENDING },
            { workId: work.id, title: 'Creative Review', stepOrder: 3, status: TaskStatus.PENDING },
            { workId: work.id, title: 'Feed Uploading', stepOrder: 4, status: TaskStatus.PENDING },
          ],
        });
      }

      return work;
    });
  }

  async update(customerId: number | string, id: number | string, dto: UpdateWorkDto) {
    const numId = Number(id);
    const existing = await this.findOne(customerId, numId);

    const updated = await this.prisma.work.update({
      where: { id: numId },
      data: dto,
      include: {
        tasks: true,
      },
    });

    // If marked COMPLETED, transition 1 unit from scheduled to used
    if (dto.status === WorkStatus.COMPLETED && existing.status !== WorkStatus.COMPLETED && existing.entitlementId) {
      await this.prisma.planEntitlement.update({
        where: { id: existing.entitlementId },
        data: {
          scheduledQty: { decrement: 1 },
          usedQty: { increment: 1 },
        },
      });
    }

    return updated;
  }

  async getCalendar(customerId: number | string, dateFrom?: string, dateTo?: string) {
    const numCustomerId = Number(customerId);
    const where: any = { customerId: numCustomerId };
    if (dateFrom && dateTo) {
      where.scheduledDate = {
        gte: new Date(dateFrom),
        lte: new Date(dateTo),
      };
    }

    const items = await this.prisma.work.findMany({
      where,
      orderBy: { scheduledDate: 'asc' },
      include: {
        team: true,
        assignedTo: true,
      },
    });

    return items.map((w) => ({
      id: w.id,
      title: w.title,
      date: w.scheduledDate,
      time: w.scheduledTime,
      type: w.workType,
      status: w.status,
      assignedTo: w.assignedTo ? `${w.assignedTo.firstName} ${w.assignedTo.lastName}` : 'Assigned Team',
      team: w.team?.name || 'SSM Production Team',
    }));
  }

  async updateTaskStatus(
    customerId: number | string,
    workId: number | string,
    taskId: number | string,
    status: TaskStatus,
  ) {
    const numCustomerId = Number(customerId);
    const numWorkId = Number(workId);
    const numTaskId = Number(taskId);

    // Verify work belongs to customer
    await this.findOne(numCustomerId, numWorkId);

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
