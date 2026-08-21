import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';

@Injectable()
export class TaskService {
  constructor(private prisma: PrismaService) {}

  async create(customerId: number | string, createdById: number | string, dto: CreateTaskDto) {
    const numCustomerId = Number(customerId);
    const numCreatedById = Number(createdById);
    return this.prisma.task.create({
      data: {
        ...dto,
        assignedToId: dto.assignedToId ? Number(dto.assignedToId) : null,
        customerId: numCustomerId,
        createdById: numCreatedById,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async findAll(customerId: number | string, query: { status?: string; assignedToId?: number | string }) {
    const numCustomerId = Number(customerId);
    const where: any = { customerId: numCustomerId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.assignedToId) where.assignedToId = Number(query.assignedToId);

    return this.prisma.task.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async findOne(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const task = await this.prisma.task.findFirst({
      where: { id: numId, customerId: numCustomerId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }
    return task;
  }

  async update(customerId: number | string, id: number | string, dto: UpdateTaskDto) {
    const numId = Number(id);
    await this.findOne(customerId, numId);
    return this.prisma.task.update({
      where: { id: numId },
      data: {
        ...dto,
        assignedToId: dto.assignedToId ? Number(dto.assignedToId) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  async delete(customerId: number | string, id: number | string) {
    const numId = Number(id);
    await this.findOne(customerId, numId);
    return this.prisma.task.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });
  }
}
