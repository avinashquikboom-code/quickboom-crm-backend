import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/visit.dto';
import { VisitStatus } from '@prisma/client';

@Injectable()
export class VisitService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCustomerId(customerId?: number | string): Promise<number> {
    if (typeof customerId === 'number' && !isNaN(customerId)) {
      return customerId;
    }
    if (typeof customerId === 'string' && customerId.trim()) {
      const parsed = parseInt(customerId, 10);
      if (!isNaN(parsed)) return parsed;

      const foundCustomer = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { domain: { equals: customerId.trim(), mode: 'insensitive' } },
            { name: { equals: customerId.trim(), mode: 'insensitive' } },
          ],
        },
      });
      if (foundCustomer) return foundCustomer.id;
    }

    const fallbackCustomer = await this.prisma.customer.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });

    if (fallbackCustomer) return fallbackCustomer.id;

    const created = await this.prisma.customer.create({
      data: {
        name: 'QuickBoom Demo Enterprise',
        domain: 'quickboom.com',
        isActive: true,
      },
    });
    return created.id;
  }

  async findAll(customerId: number | string | undefined, status?: VisitStatus, page = 1, limit = 50) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const skip = (page - 1) * limit;
    const where: any = { customerId: numCustomerId };

    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.visit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          employee: true,
        },
      }),
      this.prisma.visit.count({ where }),
    ]);

    const formatted = items.map((v) => ({
      id: v.id,
      clientName: v.customerName,
      purpose: v.purpose,
      employeeName: `${v.employee?.firstName || ''} ${v.employee?.lastName || ''}`.trim() || 'Assigned Agent',
      employeeId: v.employee?.employeeCode || 'EMP-101',
      date: v.date,
      time: v.time || '10:00 AM',
      location: v.location,
      status: v.status,
      notes: v.notes,
      duration: v.duration ? `${v.duration} min` : '45 min',
    }));

    return {
      items: formatted,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    const visit = await this.prisma.visit.findFirst({
      where: { id: numId, customerId: numCustomerId },
      include: {
        employee: true,
      },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    return visit;
  }

  async create(customerId: number | string | undefined, dto: CreateVisitDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    return this.prisma.visit.create({
      data: {
        customerId: numCustomerId,
        employeeId: Number(dto.employeeId),
        customerName: dto.customerName,
        purpose: dto.purpose,
        date: new Date(dto.date),
        time: dto.time || '10:00 AM',
        location: dto.location,
        latitude: dto.latitude,
        longitude: dto.longitude,
        notes: dto.notes,
        status: VisitStatus.SCHEDULED,
      },
    });
  }

  async update(customerId: number | string | undefined, id: number | string, dto: UpdateVisitDto) {
    const numId = Number(id);
    await this.findOne(customerId, numId);
    return this.prisma.visit.update({
      where: { id: numId },
      data: dto,
    });
  }

  async remove(customerId: number | string | undefined, id: number | string) {
    const numId = Number(id);
    await this.findOne(customerId, numId);
    return this.prisma.visit.update({
      where: { id: numId },
      data: { status: VisitStatus.CANCELLED },
    });
  }
}
