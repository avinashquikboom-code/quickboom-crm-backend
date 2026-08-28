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
          deletedAt: null,
        },
      });
      if (foundCustomer) return foundCustomer.id;
    }

    return undefined;
  }

  async getMetrics(customerId: number | string | undefined, user?: any) {
    const isSuperAdmin =
      user?.role === 'SUPER_ADMIN' ||
      user?.roleType === 'SUPER_ADMIN' ||
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('Super Administrator') ||
      customerId === undefined;

    const numCustomerId = await this.resolveCustomerId(customerId || user?.customerId);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const baseWhere: any = {};
    if (!isSuperAdmin) {
      if (numCustomerId !== undefined && numCustomerId > 0) {
        baseWhere.customerId = numCustomerId;
      } else {
        baseWhere.customerId = 0;
      }
    } else if (numCustomerId !== undefined && numCustomerId > 0) {
      baseWhere.customerId = numCustomerId;
    }

    const [todayVisits, upcoming, completed, cancelled] = await Promise.all([
      this.prisma.visit.count({
        where: {
          ...baseWhere,
          date: { gte: startOfToday, lte: endOfToday },
        },
      }),
      this.prisma.visit.count({
        where: {
          ...baseWhere,
          status: 'SCHEDULED',
          date: { gte: endOfToday },
        },
      }),
      this.prisma.visit.count({
        where: {
          ...baseWhere,
          status: 'COMPLETED',
        },
      }),
      this.prisma.visit.count({
        where: {
          ...baseWhere,
          status: 'CANCELLED',
        },
      }),
    ]);

    return {
      today: todayVisits,
      upcoming,
      completed,
      cancelled,
    };
  }

  async findAll(
    customerId: number | string | undefined,
    status?: VisitStatus,
    page = 1,
    limit = 50,
    search?: string,
    employeeId?: string,
    companyId?: string,
    user?: any,
  ) {
    const isSuperAdmin =
      user?.role === 'SUPER_ADMIN' ||
      user?.roleType === 'SUPER_ADMIN' ||
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('Super Administrator') ||
      customerId === undefined;

    const numCustomerId = await this.resolveCustomerId(customerId || user?.customerId);
    const skip = (page - 1) * limit;
    const where: any = {};

    if (!isSuperAdmin) {
      if (numCustomerId !== undefined && numCustomerId > 0) {
        where.customerId = numCustomerId;
      } else {
        where.customerId = 0;
      }
    } else if (numCustomerId !== undefined && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    if (status && (status as any) !== 'ALL') where.status = status;
    if (employeeId && employeeId !== 'ALL') where.employeeId = Number(employeeId);
    if (companyId && companyId !== 'ALL') where.companyId = Number(companyId);

    if (search && search.trim()) {
      const s = search.trim();
      where.OR = [
        { customerName: { contains: s, mode: 'insensitive' } },
        { purpose: { contains: s, mode: 'insensitive' } },
        { location: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.visit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          company: { select: { id: true, name: true, city: true } },
          contact: { select: { id: true, firstName: true, lastName: true, phone: true } },
          deal: { select: { id: true, title: true, amount: true } },
          lead: { select: { id: true, title: true } },
        },
      }),
      this.prisma.visit.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items,
      data: items,
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
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    const where: any = { id: numId };
    if (numCustomerId !== undefined && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const visit = await this.prisma.visit.findFirst({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true } },
        company: true,
        contact: true,
        deal: true,
        lead: true,
      },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    return visit;
  }

  async create(customerId: number | string | undefined, dto: CreateVisitDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    // Fallback employee if not specified
    let employeeId = dto.employeeId ? Number(dto.employeeId) : undefined;
    if (!employeeId) {
      const emp = await this.prisma.employee.findFirst({ where: { customerId: numCustomerId } });
      employeeId = emp?.id;
    }

    if (!employeeId) {
      const emp = await this.prisma.employee.create({
        data: {
          customerId: numCustomerId,
          employeeCode: `EMP-${Date.now().toString().slice(-4)}`,
          firstName: 'CRM',
          lastName: 'Executive',
          email: `rep_${Date.now()}@quikboom.com`,
        },
      });
      employeeId = emp.id;
    }

    return this.prisma.visit.create({
      data: {
        customerId: numCustomerId,
        employeeId: employeeId,
        companyId: dto.companyId ? Number(dto.companyId) : undefined,
        contactId: dto.contactId ? Number(dto.contactId) : undefined,
        dealId: dto.dealId ? Number(dto.dealId) : undefined,
        leadId: dto.leadId ? Number(dto.leadId) : undefined,
        customerName: dto.customerName,
        purpose: dto.purpose,
        visitType: dto.visitType || 'CLIENT_MEETING',
        date: new Date(dto.date),
        time: dto.time || '10:00 AM',
        location: dto.location,
        latitude: dto.latitude,
        longitude: dto.longitude,
        status: dto.status || VisitStatus.SCHEDULED,
        notes: dto.notes,
        outcome: dto.outcome,
        nextFollowUpDate: dto.nextFollowUpDate ? new Date(dto.nextFollowUpDate) : undefined,
      },
      include: {
        employee: true,
        company: true,
        contact: true,
        deal: true,
      },
    });
  }

  async update(customerId: number | string | undefined, id: number | string, dto: UpdateVisitDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    const data: any = {};
    if (dto.employeeId) data.employeeId = Number(dto.employeeId);
    if (dto.customerName) data.customerName = dto.customerName;
    if (dto.purpose) data.purpose = dto.purpose;
    if (dto.date) data.date = new Date(dto.date);
    if (dto.time) data.time = dto.time;
    if (dto.location) data.location = dto.location;
    if (dto.status) data.status = dto.status;
    if (dto.notes) data.notes = dto.notes;
    if (dto.outcome) data.outcome = dto.outcome;
    if (dto.nextFollowUpDate) data.nextFollowUpDate = new Date(dto.nextFollowUpDate);

    if (dto.status === VisitStatus.COMPLETED) {
      data.completedAt = new Date();
    }

    return this.prisma.visit.update({
      where: { id: numId },
      data,
      include: {
        employee: true,
        company: true,
        contact: true,
        deal: true,
      },
    });
  }

  async remove(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.visit.delete({
      where: { id: numId },
    });
  }
}
