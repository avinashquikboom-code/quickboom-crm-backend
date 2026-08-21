import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/visit.dto';
import { VisitStatus } from '@prisma/client';

@Injectable()
export class VisitService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId: string, status?: VisitStatus, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const where: any = { customerId };

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

  async findOne(customerId: string, id: string) {
    const visit = await this.prisma.visit.findFirst({
      where: { id, customerId },
      include: {
        employee: true,
      },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    return visit;
  }

  async create(customerId: string, dto: CreateVisitDto) {
    return this.prisma.visit.create({
      data: {
        customerId,
        employeeId: dto.employeeId,
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

  async update(customerId: string, id: string, dto: UpdateVisitDto) {
    await this.findOne(customerId, id);
    return this.prisma.visit.update({
      where: { id },
      data: dto,
    });
  }

  async remove(customerId: string, id: string) {
    await this.findOne(customerId, id);
    return this.prisma.visit.update({
      where: { id },
      data: { status: VisitStatus.CANCELLED },
    });
  }
}
