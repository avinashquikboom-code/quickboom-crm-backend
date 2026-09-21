import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/designation.dto';

@Injectable()
export class DesignationService {
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
    return cleaned.substring(0, 6) || 'DESIG';
  }

  async findAll(
    customerId: number | string,
    options: {
      departmentId?: number;
      search?: string;
      isActive?: boolean;
      status?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const { departmentId, search, isActive, status, page = 1, limit = 100 } = options;

    const where: any = { customerId: numCustomerId };

    if (departmentId !== undefined && departmentId !== null && !isNaN(Number(departmentId))) {
      const numDeptId = Number(departmentId);
      // Either assigned specifically to this department, or global (departmentId is null)
      where.OR = [
        { departmentId: numDeptId },
        { departmentId: null },
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    } else if (status) {
      where.isActive = status.toUpperCase() === 'ACTIVE';
    }

    if (search && search.trim()) {
      const q = search.trim();
      const searchConditions = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
      if (where.OR) {
        where.AND = [{ OR: searchConditions }];
      } else {
        where.OR = searchConditions;
      }
    }

    const skip = (Math.max(1, page) - 1) * Math.max(1, limit);

    const [total, designations] = await Promise.all([
      this.prisma.designation.count({ where }),
      this.prisma.designation.findMany({
        where,
        include: {
          department: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          _count: {
            select: {
              employees: true,
            },
          },
        },
        orderBy: [{ level: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
    ]);

    const formatted = designations.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      departmentId: d.departmentId,
      departmentName: d.department?.name || 'All Departments / General',
      department: d.department,
      description: d.description,
      level: d.level,
      isActive: d.isActive,
      status: d.isActive ? 'ACTIVE' : 'INACTIVE',
      employeesCount: d._count.employees,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    return {
      data: formatted,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(customerId: number | string, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const designation = await this.prisma.designation.findFirst({
      where: { id, customerId: numCustomerId },
      include: {
        department: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            employees: true,
          },
        },
      },
    });

    if (!designation) {
      throw new NotFoundException(`Designation #${id} not found`);
    }

    return {
      id: designation.id,
      name: designation.name,
      code: designation.code,
      departmentId: designation.departmentId,
      departmentName: designation.department?.name || 'All Departments / General',
      department: designation.department,
      description: designation.description,
      level: designation.level,
      isActive: designation.isActive,
      status: designation.isActive ? 'ACTIVE' : 'INACTIVE',
      employeesCount: designation._count.employees,
      createdAt: designation.createdAt,
      updatedAt: designation.updatedAt,
    };
  }

  async create(customerId: number | string, dto: CreateDesignationDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const name = dto.name.trim();
    let code = dto.code?.trim().toUpperCase() || this.generateCode(name);

    // Validate departmentId if provided
    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, customerId: numCustomerId },
      });
      if (!dept) {
        throw new BadRequestException(`Department #${dto.departmentId} does not exist`);
      }
    }

    // Check duplicate code or name
    const existing = await this.prisma.designation.findFirst({
      where: {
        customerId: numCustomerId,
        OR: [{ name: { equals: name, mode: 'insensitive' } }, { code: { equals: code } }],
      },
    });

    if (existing) {
      if (existing.name.toLowerCase() === name.toLowerCase()) {
        throw new ConflictException(`Designation with name "${name}" already exists`);
      }
      code = `${code.substring(0, 4)}${Math.floor(10 + Math.random() * 90)}`;
    }

    const created = await this.prisma.designation.create({
      data: {
        customerId: numCustomerId,
        name,
        code,
        departmentId: dto.departmentId || null,
        description: dto.description?.trim() || null,
        level: dto.level !== undefined ? dto.level : 1,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    // Auto-create matching Role so permissions can be configured immediately for this designation
    try {
      const existingRole = await this.prisma.role.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          customerId: numCustomerId,
        },
      });
      if (!existingRole) {
        await this.prisma.role.create({
          data: {
            customerId: numCustomerId,
            name,
            description: dto.description?.trim() || `${name} role`,
            type: 'CUSTOM',
          },
        });
      }
    } catch (_) {}

    return {
      id: created.id,
      name: created.name,
      code: created.code,
      departmentId: created.departmentId,
      departmentName: created.department?.name || 'All Departments / General',
      department: created.department,
      description: created.description,
      level: created.level,
      isActive: created.isActive,
      status: created.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async update(customerId: number | string, id: number, dto: UpdateDesignationDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const existing = await this.prisma.designation.findFirst({
      where: { id, customerId: numCustomerId },
    });

    if (!existing) {
      throw new NotFoundException(`Designation #${id} not found`);
    }

    if (dto.departmentId !== undefined && dto.departmentId !== null) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, customerId: numCustomerId },
      });
      if (!dept) {
        throw new BadRequestException(`Department #${dto.departmentId} does not exist`);
      }
    }

    if (dto.name) {
      const duplicateName = await this.prisma.designation.findFirst({
        where: {
          customerId: numCustomerId,
          name: { equals: dto.name.trim(), mode: 'insensitive' },
          NOT: { id },
        },
      });
      if (duplicateName) {
        throw new ConflictException(`Designation with name "${dto.name}" already exists`);
      }
    }

    if (dto.code) {
      const duplicateCode = await this.prisma.designation.findFirst({
        where: {
          customerId: numCustomerId,
          code: { equals: dto.code.trim().toUpperCase() },
          NOT: { id },
        },
      });
      if (duplicateCode) {
        throw new ConflictException(`Designation with code "${dto.code}" already exists`);
      }
    }

    const updated = await this.prisma.designation.update({
      where: { id },
      data: {
        name: dto.name ? dto.name.trim() : undefined,
        code: dto.code ? dto.code.trim().toUpperCase() : undefined,
        departmentId: dto.departmentId !== undefined ? dto.departmentId : undefined,
        description: dto.description !== undefined ? dto.description : undefined,
        level: dto.level !== undefined ? dto.level : undefined,
        isActive: dto.isActive !== undefined ? dto.isActive : undefined,
      },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      code: updated.code,
      departmentId: updated.departmentId,
      departmentName: updated.department?.name || 'All Departments / General',
      department: updated.department,
      description: updated.description,
      level: updated.level,
      isActive: updated.isActive,
      status: updated.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async remove(customerId: number | string, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const designation = await this.prisma.designation.findFirst({
      where: { id, customerId: numCustomerId },
      include: {
        _count: {
          select: {
            employees: true,
          },
        },
      },
    });

    if (!designation) {
      throw new NotFoundException(`Designation #${id} not found`);
    }

    // Safety rule: If employees have this designation, soft-deactivate to avoid losing employee reference
    if (designation._count.employees > 0) {
      await this.prisma.designation.update({
        where: { id },
        data: { isActive: false },
      });
      return {
        message: `Designation #${id} has ${designation._count.employees} employees assigned. Deactivated (marked INACTIVE) safely.`,
        deactivated: true,
      };
    }

    await this.prisma.designation.delete({ where: { id } });
    return {
      message: `Designation #${id} deleted successfully.`,
      deleted: true,
    };
  }
}
