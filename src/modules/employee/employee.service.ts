import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

export interface FindAllEmployeesParams {
  customerId?: number | string;
  isSuperAdmin?: boolean;
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface EmployeeFindOneParams {
  id: number | string;
  customerId?: number | string;
  isSuperAdmin?: boolean;
}

export interface CreateEmployeeParams {
  customerId: number | string;
  dto: CreateEmployeeDto;
}

export interface UpdateEmployeeParams {
  id: number | string;
  customerId?: number | string;
  isSuperAdmin?: boolean;
  dto: UpdateEmployeeDto;
}

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: FindAllEmployeesParams) {
    const { customerId, isSuperAdmin, search, status, page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) {
        throw new BadRequestException('Invalid customerId provided');
      }
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for employee access');
    }

    if (status) where.status = status;
    if (search && search.trim().length > 0) {
      const trimmedSearch = search.trim();
      where.OR = [
        { firstName: { contains: trimmedSearch, mode: 'insensitive' } },
        { lastName: { contains: trimmedSearch, mode: 'insensitive' } },
        { email: { contains: trimmedSearch, mode: 'insensitive' } },
        { employeeCode: { contains: trimmedSearch, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          department: true,
          designation: true,
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    const formatted = items.map((e) => ({
      id: e.id,
      customerId: e.customerId,
      employeeId: e.employeeCode,
      name: `${e.firstName} ${e.lastName}`,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email,
      phone: e.phone || '+91 98765 43210',
      designation: e.designation?.name || 'SSM Specialist',
      department: e.department?.name || 'Media & Production',
      branch: e.branch || 'Head Office',
      status: e.status,
      joiningDate: e.joiningDate,
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

  async findOne(params: EmployeeFindOneParams) {
    const { id, customerId, isSuperAdmin } = params;
    const numId = Number(id);
    if (isNaN(numId)) {
      throw new BadRequestException('Invalid employee ID');
    }

    const where: any = { id: numId };

    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) {
        throw new BadRequestException('Invalid customerId provided');
      }
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for employee access');
    }

    const employee = await this.prisma.employee.findFirst({
      where,
      include: {
        department: true,
        designation: true,
        attendances: { take: 5, orderBy: { date: 'desc' } },
        works: { take: 5, orderBy: { scheduledDate: 'desc' } },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    return {
      id: employee.id,
      customerId: employee.customerId,
      employeeId: employee.employeeCode,
      name: `${employee.firstName} ${employee.lastName}`,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      phone: employee.phone,
      branch: employee.branch,
      department: employee.department?.name || 'Media & Production',
      designation: employee.designation?.name || 'SSM Specialist',
      status: employee.status,
      attendances: employee.attendances,
      works: employee.works,
    };
  }

  async create(params: CreateEmployeeParams) {
    const { customerId, dto } = params;
    const numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new BadRequestException('Valid customerId is required');
    }

    // Verify or create department scoped to the authenticated customer
    let department = await this.prisma.department.findFirst({
      where: { customerId: numCustomerId, name: dto.departmentName || 'Media & Production' },
    });
    if (!department) {
      department = await this.prisma.department.create({
        data: {
          customerId: numCustomerId,
          name: dto.departmentName || 'Media & Production',
          code: (dto.departmentName || 'MED').substring(0, 4).toUpperCase(),
        },
      });
    }

    // Verify or create designation scoped to the authenticated customer
    let designation = await this.prisma.designation.findFirst({
      where: { customerId: numCustomerId, name: dto.designationName || 'Photographer' },
    });
    if (!designation) {
      designation = await this.prisma.designation.create({
        data: {
          customerId: numCustomerId,
          name: dto.designationName || 'Photographer',
          code: (dto.designationName || 'PHT').substring(0, 4).toUpperCase(),
          departmentId: department.id,
        },
      });
    }

    return this.prisma.employee.create({
      data: {
        customerId: numCustomerId,
        employeeCode: dto.employeeCode,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        branch: dto.branch || 'Head Office',
        departmentId: department.id,
        designationId: designation.id,
        status: 'ACTIVE',
      },
      include: {
        department: true,
        designation: true,
      },
    });
  }

  async update(params: UpdateEmployeeParams) {
    const { id, customerId, isSuperAdmin, dto } = params;
    // Strict ownership verification: ensure employee exists and belongs to customer
    await this.findOne({ id, customerId, isSuperAdmin });

    const numId = Number(id);
    return this.prisma.employee.update({
      where: { id: numId },
      data: dto,
      include: {
        department: true,
        designation: true,
      },
    });
  }

  async remove(params: EmployeeFindOneParams) {
    const { id, customerId, isSuperAdmin } = params;
    // Strict ownership verification: ensure employee exists and belongs to customer
    await this.findOne({ id, customerId, isSuperAdmin });

    const numId = Number(id);
    return this.prisma.employee.update({
      where: { id: numId },
      data: { status: 'INACTIVE' },
    });
  }

  async getLeaves(customerId?: number | string, isSuperAdmin = false) {
    const where: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for leaves access');
    }

    const leaves = await this.prisma.leaveRequest.findMany({
      where,
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });

    return leaves.map((l) => ({
      id: String(l.id),
      customerId: l.customerId,
      employeeName: l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : 'Employee',
      employeeId: l.employee?.employeeCode || 'EMP-001',
      leaveType: l.leaveType?.name || 'Casual Leave',
      fromDate: l.fromDate ? l.fromDate.toISOString().split('T')[0] : '2026-08-20',
      toDate: l.toDate ? l.toDate.toISOString().split('T')[0] : '2026-08-22',
      totalDays: l.days || 1,
      reason: l.reason || 'Leave request',
      status: l.status,
      appliedOn: l.createdAt ? l.createdAt.toISOString().split('T')[0] : '2026-08-15',
    }));
  }

  async getRemoteRequests(customerId?: number | string, isSuperAdmin = false) {
    const where: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for remote requests access');
    }

    const requests = await this.prisma.remoteRequest.findMany({
      where,
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((r) => ({
      id: String(r.id),
      customerId: r.customerId,
      employeeName: r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : 'Employee',
      employeeId: r.employee?.employeeCode || 'EMP-001',
      requestType: 'WORK_FROM_HOME',
      date: r.fromDate ? r.fromDate.toISOString().split('T')[0] : '2026-08-21',
      reason: r.reason || 'Remote work request',
      status: r.status,
      appliedOn: r.createdAt ? r.createdAt.toISOString().split('T')[0] : '2026-08-15',
    }));
  }

  async getAttendance(customerId?: number | string, isSuperAdmin = false) {
    const where: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for attendance access');
    }

    const records = await this.prisma.attendance.findMany({
      where,
      include: { employee: true },
      orderBy: { date: 'desc' },
      take: 50,
    });

    return records.map((a) => ({
      id: String(a.id),
      customerId: a.customerId,
      employeeName: a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : 'Employee',
      employeeId: a.employee?.employeeCode || 'EMP-001',
      date: a.date ? a.date.toISOString().split('T')[0] : '2026-08-21',
      punchIn: a.punchIn ? a.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '09:00 AM',
      punchOut: a.punchOut ? a.punchOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '06:00 PM',
      workingHours: a.workingHours ? `${a.workingHours}h` : '8h',
      status: a.status,
      location: a.locationIn || 'Office GPS',
    }));
  }
}
