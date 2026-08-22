import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateRemoteRequestDto,
  RejectRemoteRequestDto,
  RemoteRequestQueryDto,
} from './dto/remote-work.dto';
import { RequestStatus } from '@prisma/client';

@Injectable()
export class RemoteWorkService {
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

    const fallback = await this.prisma.customer.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    if (fallback) return fallback.id;

    const created = await this.prisma.customer.create({
      data: {
        name: 'QuickBoom Demo Enterprise',
        domain: 'quickboom.com',
        isActive: true,
      },
    });
    return created.id;
  }

  async getSummary(customerId: number | string | undefined) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [totalRequests, pending, approved, rejected, todayCount] = await Promise.all([
      this.prisma.remoteRequest.count({ where: { customerId: numCustomerId } }),
      this.prisma.remoteRequest.count({
        where: { customerId: numCustomerId, status: RequestStatus.PENDING },
      }),
      this.prisma.remoteRequest.count({
        where: { customerId: numCustomerId, status: RequestStatus.APPROVED },
      }),
      this.prisma.remoteRequest.count({
        where: { customerId: numCustomerId, status: RequestStatus.REJECTED },
      }),
      this.prisma.remoteRequest.count({
        where: {
          customerId: numCustomerId,
          status: RequestStatus.APPROVED,
          fromDate: { lte: todayEnd },
          toDate: { gte: todayStart },
        },
      }),
    ]);

    return {
      totalRequests,
      pending,
      approved,
      rejected,
      todayRemoteWork: todayCount,
    };
  }

  async findAll(customerId: number | string | undefined, query?: RemoteRequestQueryDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 25));
    const skip = (page - 1) * limit;

    const where: any = { customerId: numCustomerId };

    if (query?.status && query.status !== 'ALL') {
      where.status = query.status as RequestStatus;
    }

    if (query?.search && query.search.trim()) {
      const q = query.search.trim();
      where.employee = {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { employeeCode: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    if (query?.officeId && query.officeId !== 'ALL') {
      where.employee = {
        ...(where.employee || {}),
        officeId: Number(query.officeId),
      };
    }

    if (query?.departmentId && query.departmentId !== 'ALL') {
      where.employee = {
        ...(where.employee || {}),
        departmentId: Number(query.departmentId),
      };
    }

    // Date Range Filters
    const now = new Date();
    if (query?.dateRange === 'TODAY') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      where.fromDate = { lte: end };
      where.toDate = { gte: start };
    } else if (query?.dateRange === 'THIS_WEEK') {
      const curr = new Date(now);
      const first = curr.getDate() - curr.getDay() + (curr.getDay() === 0 ? -6 : 1);
      const start = new Date(curr.setDate(first));
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      where.fromDate = { lte: end };
      where.toDate = { gte: start };
    } else if (query?.dateRange === 'THIS_MONTH') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      where.fromDate = { lte: end };
      where.toDate = { gte: start };
    } else if (query?.startDate && query?.endDate) {
      where.fromDate = { lte: new Date(query.endDate) };
      where.toDate = { gte: new Date(query.startDate) };
    }

    const [items, total, summary] = await Promise.all([
      this.prisma.remoteRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: {
            include: {
              department: true,
              designation: true,
              office: true,
            },
          },
        },
      }),
      this.prisma.remoteRequest.count({ where }),
      this.getSummary(numCustomerId),
    ]);

    const formatted = items.map((r) => {
      const fromStr = r.fromDate.toISOString().split('T')[0];
      const toStr = r.toDate.toISOString().split('T')[0];
      const dateDisplay = fromStr === toStr ? fromStr : `${fromStr} to ${toStr}`;

      return {
        id: r.id,
        customerId: r.customerId,
        employeeId: r.employeeId,
        employeeCode: r.employee?.employeeCode || `EMP-${r.employeeId}`,
        employeeName: r.employee
          ? `${r.employee.firstName} ${r.employee.lastName || ''}`.trim()
          : 'Employee',
        employee: r.employee
          ? {
              id: r.employee.id,
              employeeCode: r.employee.employeeCode,
              name: `${r.employee.firstName} ${r.employee.lastName || ''}`.trim(),
              email: r.employee.email,
              phone: r.employee.phone,
              department: r.employee.department?.name || 'General',
              designation: r.employee.designation?.name || 'Staff',
              office: r.employee.office?.name || r.employee.branch || 'Head Office',
              officeCity: r.employee.office?.city,
            }
          : null,
        office: r.employee?.office?.name || r.employee?.branch || 'Head Office',
        department: r.employee?.department?.name || 'General',
        designation: r.employee?.designation?.name || 'Staff',
        remoteWorkDate: dateDisplay,
        fromDate: fromStr,
        toDate: toStr,
        days: r.days || 1,
        duration: `${r.days || 1} ${r.days === 1 ? 'Day' : 'Days'}`,
        reason: r.reason || 'Remote Work / Work From Home',
        attachmentUrl: r.attachmentUrl,
        status: r.status,
        rejectionReason: r.rejectionReason,
        approvedByName: r.approvedByName,
        approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
        rejectedByName: r.rejectedByName,
        rejectedAt: r.rejectedAt ? r.rejectedAt.toISOString() : null,
        appliedOn: r.createdAt.toISOString().split('T')[0],
        createdAt: r.createdAt.toISOString(),
      };
    });

    return {
      summary,
      requests: formatted,
      data: formatted,
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

    const r = await this.prisma.remoteRequest.findFirst({
      where: { id: numId, customerId: numCustomerId },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
            office: true,
          },
        },
      },
    });

    if (!r) {
      throw new NotFoundException(`Remote work request #${id} not found.`);
    }

    const fromStr = r.fromDate.toISOString().split('T')[0];
    const toStr = r.toDate.toISOString().split('T')[0];
    const dateDisplay = fromStr === toStr ? fromStr : `${fromStr} to ${toStr}`;

    return {
      id: r.id,
      customerId: r.customerId,
      employeeId: r.employeeId,
      employeeCode: r.employee?.employeeCode || `EMP-${r.employeeId}`,
      employeeName: r.employee
        ? `${r.employee.firstName} ${r.employee.lastName || ''}`.trim()
        : 'Employee',
      employee: r.employee
        ? {
            id: r.employee.id,
            employeeCode: r.employee.employeeCode,
            name: `${r.employee.firstName} ${r.employee.lastName || ''}`.trim(),
            email: r.employee.email,
            phone: r.employee.phone,
            department: r.employee.department?.name || 'General',
            designation: r.employee.designation?.name || 'Staff',
            office: r.employee.office?.name || r.employee.branch || 'Head Office',
            officeCity: r.employee.office?.city,
          }
        : null,
      office: r.employee?.office?.name || r.employee?.branch || 'Head Office',
      department: r.employee?.department?.name || 'General',
      designation: r.employee?.designation?.name || 'Staff',
      remoteWorkDate: dateDisplay,
      fromDate: fromStr,
      toDate: toStr,
      days: r.days || 1,
      duration: `${r.days || 1} ${r.days === 1 ? 'Day' : 'Days'}`,
      reason: r.reason || 'Remote Work / Work From Home',
      attachmentUrl: r.attachmentUrl,
      status: r.status,
      rejectionReason: r.rejectionReason,
      approvedByName: r.approvedByName,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      rejectedByName: r.rejectedByName,
      rejectedAt: r.rejectedAt ? r.rejectedAt.toISOString() : null,
      appliedOn: r.createdAt.toISOString().split('T')[0],
      createdAt: r.createdAt.toISOString(),
    };
  }

  async approve(user: any, customerId: number | string | undefined, id: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);

    const r = await this.prisma.remoteRequest.findFirst({
      where: { id: numId, customerId: numCustomerId },
      include: { employee: true },
    });

    if (!r) {
      throw new NotFoundException(`Remote work request #${id} not found.`);
    }

    if (r.status !== RequestStatus.PENDING) {
      throw new BadRequestException(`Cannot approve request that is already ${r.status}.`);
    }

    const approverName = user?.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : 'HR Administrator';

    const updated = await this.prisma.remoteRequest.update({
      where: { id: numId },
      data: {
        status: RequestStatus.APPROVED,
        approvedById: user?.id || null,
        approvedByName: approverName,
        approvedAt: new Date(),
      },
      include: { employee: true },
    });

    return {
      success: true,
      message: `Remote work request approved for ${updated.employee?.firstName || 'Employee'}.`,
      data: updated,
    };
  }

  async reject(
    user: any,
    customerId: number | string | undefined,
    id: number | string,
    dto: RejectRemoteRequestDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);

    const r = await this.prisma.remoteRequest.findFirst({
      where: { id: numId, customerId: numCustomerId },
      include: { employee: true },
    });

    if (!r) {
      throw new NotFoundException(`Remote work request #${id} not found.`);
    }

    if (r.status !== RequestStatus.PENDING) {
      throw new BadRequestException(`Cannot reject request that is already ${r.status}.`);
    }

    const trimmedReason = dto.rejectionReason?.trim();
    if (!trimmedReason) {
      throw new BadRequestException('Mandatory rejection reason is required.');
    }

    const rejectorName = user?.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : 'HR Administrator';

    const updated = await this.prisma.remoteRequest.update({
      where: { id: numId },
      data: {
        status: RequestStatus.REJECTED,
        rejectedById: user?.id || null,
        rejectedByName: rejectorName,
        rejectedAt: new Date(),
        rejectionReason: trimmedReason,
      },
      include: { employee: true },
    });

    return {
      success: true,
      message: `Remote work request rejected for ${updated.employee?.firstName || 'Employee'}.`,
      data: updated,
    };
  }

  async create(user: any, customerId: number | string | undefined, dto: CreateRemoteRequestDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const employee = await this.prisma.employee.findFirst({
      where: { id: Number(dto.employeeId), customerId: numCustomerId, status: 'ACTIVE' },
    });

    if (!employee) {
      throw new NotFoundException(`Active employee #${dto.employeeId} not found.`);
    }

    const fromDate = new Date(dto.fromDate);
    const toDate = new Date(dto.toDate);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException('Valid fromDate and toDate are required.');
    }

    if (fromDate > toDate) {
      throw new BadRequestException('End date cannot be earlier than start date.');
    }

    // Overlapping active remote requests prevention
    const overlapping = await this.prisma.remoteRequest.findFirst({
      where: {
        customerId: numCustomerId,
        employeeId: employee.id,
        status: { in: [RequestStatus.PENDING, RequestStatus.APPROVED] },
        fromDate: { lte: toDate },
        toDate: { gte: fromDate },
      },
    });

    if (overlapping) {
      throw new ConflictException(
        `An overlapping active remote work request already exists for ${employee.firstName} between ${overlapping.fromDate.toISOString().split('T')[0]} and ${overlapping.toDate.toISOString().split('T')[0]}.`,
      );
    }

    const diffDays = Math.max(
      1,
      Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
    );

    const created = await this.prisma.remoteRequest.create({
      data: {
        customerId: numCustomerId,
        employeeId: employee.id,
        fromDate,
        toDate,
        days: dto.days || diffDays,
        reason: dto.reason?.trim() || 'Work From Home',
        attachmentUrl: dto.attachmentUrl,
        status: RequestStatus.PENDING,
      },
      include: {
        employee: {
          include: { department: true, designation: true, office: true },
        },
      },
    });

    return {
      success: true,
      message: 'Remote work request submitted successfully.',
      data: created,
    };
  }

  async getTodayRemoteWorkers(customerId: number | string | undefined) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const activeRemoteRequests = await this.prisma.remoteRequest.findMany({
      where: {
        customerId: numCustomerId,
        status: RequestStatus.APPROVED,
        fromDate: { lte: todayEnd },
        toDate: { gte: todayStart },
      },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
            office: true,
            attendances: {
              where: {
                date: { gte: todayStart, lte: todayEnd },
              },
              include: {
                breaks: true,
              },
            },
          },
        },
      },
    });

    return activeRemoteRequests.map((r) => {
      const att = r.employee?.attendances?.[0];
      const punchInStr = att?.punchIn
        ? att.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Not Punched In';
      const punchOutStr = att?.punchOut
        ? att.punchOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—';

      const totalBreakMins = att?.breaks?.reduce((sum, b) => sum + (b.duration || 0), 0) || 0;
      const breakStr = totalBreakMins > 0 ? `${totalBreakMins} min` : '0 min';

      return {
        id: r.id,
        employeeId: r.employeeId,
        employeeCode: r.employee?.employeeCode || `EMP-${r.employeeId}`,
        name: r.employee ? `${r.employee.firstName} ${r.employee.lastName || ''}`.trim() : 'Employee',
        office: r.employee?.office?.name || r.employee?.branch || 'Head Office',
        department: r.employee?.department?.name || 'General',
        designation: r.employee?.designation?.name || 'Staff',
        remoteWorkDate: todayStart.toISOString().split('T')[0],
        attendanceStatus: att?.status || 'REMOTE_APPROVED',
        punchIn: punchInStr,
        break: breakStr,
        punchOut: punchOutStr,
        workingHours: att?.workingHours || 0,
      };
    });
  }
}
