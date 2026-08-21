import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId: string, search?: string, status?: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const where: any = { customerId };

    if (status) where.status = status;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
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
      employeeId: e.employeeCode,
      name: `${e.firstName} ${e.lastName}`,
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

  async findOne(customerId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, customerId },
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

  async create(customerId: string, dto: CreateEmployeeDto) {
    let department = await this.prisma.department.findFirst({
      where: { customerId, name: dto.departmentName || 'Media & Production' },
    });
    if (!department) {
      department = await this.prisma.department.create({
        data: {
          customerId,
          name: dto.departmentName || 'Media & Production',
          code: (dto.departmentName || 'MED').substring(0, 4).toUpperCase(),
        },
      });
    }

    let designation = await this.prisma.designation.findFirst({
      where: { customerId, name: dto.designationName || 'Photographer' },
    });
    if (!designation) {
      designation = await this.prisma.designation.create({
        data: {
          customerId,
          name: dto.designationName || 'Photographer',
          code: (dto.designationName || 'PHT').substring(0, 4).toUpperCase(),
          departmentId: department.id,
        },
      });
    }

    return this.prisma.employee.create({
      data: {
        customerId,
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
    });
  }

  async update(customerId: string, id: string, dto: UpdateEmployeeDto) {
    await this.findOne(customerId, id);
    return this.prisma.employee.update({
      where: { id },
      data: dto,
    });
  }

  async remove(customerId: string, id: string) {
    await this.findOne(customerId, id);
    return this.prisma.employee.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }
}
