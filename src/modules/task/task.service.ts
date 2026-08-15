import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';

@Injectable()
export class TaskService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, createdById: string, dto: CreateTaskDto) {
    return this.prisma.task.create({
      data: {
        ...dto,
        tenantId,
        createdById,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async findAll(tenantId: string, query: { status?: string; assignedToId?: string }) {
    const where: any = { tenantId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.assignedToId) where.assignedToId = query.assignedToId;

    return this.prisma.task.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, tenantId, deletedAt: null },
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

  async update(tenantId: string, id: string, dto: UpdateTaskDto) {
    await this.findOne(tenantId, id);
    return this.prisma.task.update({
      where: { id },
      data: {
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  async delete(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.task.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
