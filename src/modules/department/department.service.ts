import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

@Injectable()
export class DepartmentService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCustomerId(customerId: number | string): Promise<number> {
    if (typeof customerId === 'number' && customerId > 0) return customerId;
    if (typeof customerId === 'string' && !isNaN(Number(customerId)) && Number(customerId) > 0) {
      return Number(customerId);
    }
    const firstCustomer = await this.prisma.customer.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return firstCustomer?.id || 1;
  }

  private generateCode(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return cleaned.substring(0, 6) || 'DEPT';
  }

  async findAll(
    customerId: number | string,
    options: {
      search?: string;
      isActive?: boolean;
      status?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const { search, isActive, status, page = 1, limit = 100 } = options;

    const where: any = { customerId: numCustomerId };

    if (isActive !== undefined) {
      where.isActive = isActive;
    } else if (status) {
      where.isActive = status.toUpperCase() === 'ACTIVE';
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const skip = (Math.max(1, page) - 1) * Math.max(1, limit);

    let [total, departments] = await Promise.all([
      this.prisma.department.count({ where }),
      this.prisma.department.findMany({
        where,
        include: {
          _count: {
            select: {
              employees: true,
              designations: true,
            },
          },
          designations: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              code: true,
              isActive: true,
            },
          },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    // Auto-seed standard departments if customer has 0 departments
    if (total === 0 && !search) {
      const defaultDepts = [
        { name: 'Engineering & IT', code: 'ENG', description: 'Software and infrastructure operations' },
        { name: 'Sales & Marketing', code: 'SALES', description: 'Business development and client growth' },
        { name: 'Human Resources', code: 'HR', description: 'Talent and employee relations' },
        { name: 'Operations', code: 'OPS', description: 'Daily business logistics and processes' },
        { name: 'Finance & Accounts', code: 'FIN', description: 'Accounting and payroll management' },
      ];

      for (const d of defaultDepts) {
        await this.prisma.department.create({
          data: {
            customerId: numCustomerId,
            name: d.name,
            code: d.code,
            description: d.description,
            isActive: true,
          },
        }).catch(() => null);
      }

      [total, departments] = await Promise.all([
        this.prisma.department.count({ where }),
        this.prisma.department.findMany({
          where,
          include: {
            _count: {
              select: {
                employees: true,
                designations: true,
              },
            },
            designations: {
              where: { isActive: true },
              select: {
                id: true,
                name: true,
                code: true,
                isActive: true,
              },
            },
          },
          orderBy: { name: 'asc' },
          skip,
          take: limit,
        }),
      ]);
    }

    // Lookup department head names if headId is present
    const headIds = departments
      .map((d) => d.headId)
      .filter((id): id is number => typeof id === 'number' && id > 0);

    let headsMap = new Map<number, string>();
    if (headIds.length > 0) {
      const heads = await this.prisma.employee.findMany({
        where: { id: { in: headIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      heads.forEach((h) => headsMap.set(h.id, `${h.firstName} ${h.lastName}`.trim()));
    }

    const formatted = departments.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      description: d.description,
      headId: d.headId,
      head: d.headId ? headsMap.get(d.headId) || 'Unassigned' : 'Unassigned',
      isActive: d.isActive,
      status: d.isActive ? 'ACTIVE' : 'INACTIVE',
      employeesCount: d._count.employees,
      designationsCount: d._count.designations,
      designations: d.designations,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    return {
      data: formatted,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(customerId: number | string, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const department = await this.prisma.department.findFirst({
      where: { id, customerId: numCustomerId },
      include: {
        _count: {
          select: {
            employees: true,
            designations: true,
          },
        },
        designations: {
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!department) {
      throw new NotFoundException({
        success: false,
        message: `Department #${id} not found`,
        error: 'DEPARTMENT_NOT_FOUND',
      });
    }

    let headName = 'Unassigned';
    if (department.headId) {
      const head = await this.prisma.employee.findUnique({
        where: { id: department.headId },
        select: { firstName: true, lastName: true },
      });
      if (head) {
        headName = `${head.firstName} ${head.lastName}`.trim();
      }
    }

    return {
      id: department.id,
      name: department.name,
      code: department.code,
      description: department.description,
      headId: department.headId,
      head: headName,
      isActive: department.isActive,
      status: department.isActive ? 'ACTIVE' : 'INACTIVE',
      employeesCount: department._count.employees,
      designationsCount: department._count.designations,
      designations: department.designations,
      createdAt: department.createdAt,
      updatedAt: department.updatedAt,
    };
  }

  async create(customerId: number | string, dto: CreateDepartmentDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const name = dto.name.trim();
    let code = dto.code?.trim().toUpperCase() || this.generateCode(name);

    // Check duplicate code or duplicate name for this customer
    const existing = await this.prisma.department.findFirst({
      where: {
        customerId: numCustomerId,
        OR: [{ name: { equals: name, mode: 'insensitive' } }, { code: { equals: code } }],
      },
    });

    if (existing) {
      if (existing.name.toLowerCase() === name.toLowerCase()) {
        throw new ConflictException(`Department with name "${name}" already exists`);
      }
      // If code collides, append random 2 digits
      code = `${code.substring(0, 4)}${Math.floor(10 + Math.random() * 90)}`;
    }

    const created = await this.prisma.department.create({
      data: {
        customerId: numCustomerId,
        name,
        code,
        description: dto.description?.trim() || null,
        headId: dto.headId || null,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
    });

    return {
      id: created.id,
      name: created.name,
      code: created.code,
      description: created.description,
      headId: created.headId,
      isActive: created.isActive,
      status: created.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async update(customerId: number | string, id: number, dto: UpdateDepartmentDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const existing = await this.prisma.department.findFirst({
      where: { id, customerId: numCustomerId },
    });

    if (!existing) {
      throw new NotFoundException(`Department #${id} not found`);
    }

    if (dto.name) {
      const duplicateName = await this.prisma.department.findFirst({
        where: {
          customerId: numCustomerId,
          name: { equals: dto.name.trim(), mode: 'insensitive' },
          NOT: { id },
        },
      });
      if (duplicateName) {
        throw new ConflictException(`Department with name "${dto.name}" already exists`);
      }
    }

    if (dto.code) {
      const duplicateCode = await this.prisma.department.findFirst({
        where: {
          customerId: numCustomerId,
          code: { equals: dto.code.trim().toUpperCase() },
          NOT: { id },
        },
      });
      if (duplicateCode) {
        throw new ConflictException(`Department with code "${dto.code}" already exists`);
      }
    }

    const updated = await this.prisma.department.update({
      where: { id },
      data: {
        name: dto.name ? dto.name.trim() : undefined,
        code: dto.code ? dto.code.trim().toUpperCase() : undefined,
        description: dto.description !== undefined ? dto.description : undefined,
        headId: dto.headId !== undefined ? dto.headId : undefined,
        isActive: dto.isActive !== undefined ? dto.isActive : undefined,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      code: updated.code,
      description: updated.description,
      headId: updated.headId,
      isActive: updated.isActive,
      status: updated.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async remove(customerId: number | string, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const department = await this.prisma.department.findFirst({
      where: { id, customerId: numCustomerId },
      include: {
        _count: {
          select: {
            employees: true,
            designations: true,
          },
        },
      },
    });

    if (!department) {
      throw new NotFoundException(`Department #${id} not found`);
    }

    // Safety rule: If department has assigned employees, soft-deactivate instead of hard deleting
    if (department._count.employees > 0) {
      await this.prisma.department.update({
        where: { id },
        data: { isActive: false },
      });
      return {
        message: `Department #${id} contains ${department._count.employees} employees. Deactivated (marked INACTIVE) to preserve employee records safely.`,
        deactivated: true,
      };
    }

    // If designations exist, dissociate them or soft-deactivate
    if (department._count.designations > 0) {
      await this.prisma.designation.updateMany({
        where: { departmentId: id },
        data: { departmentId: null },
      });
    }

    await this.prisma.department.delete({ where: { id } });
    return {
      message: `Department #${id} deleted successfully.`,
      deleted: true,
    };
  }
}
