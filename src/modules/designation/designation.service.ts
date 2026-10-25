import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/designation.dto';
import { PlanScheduleGateway } from '../work/plan-schedule.gateway';

@Injectable()
export class DesignationService {
  private readonly logger = new Logger(DesignationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => PlanScheduleGateway))
    private readonly planScheduleGateway: PlanScheduleGateway,
  ) {}

  private async resolveCustomerId(customerId: number | string): Promise<number> {
return undefined;
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

    const where: any = {  };

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
      crmMobileAccess: Boolean(d.crmMobileAccess),
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
      where: { id },
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
      crmMobileAccess: Boolean(designation.crmMobileAccess),
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
        where: { id: dto.departmentId },
      });
      if (!dept) {
        throw new BadRequestException(`Department #${dto.departmentId} does not exist`);
      }
    }

    // Check duplicate code or name
    const existing = await this.prisma.designation.findFirst({
      where: {
        
        OR: [{ name: { equals: name, mode: 'insensitive' } }, { code: { equals: code } }],
      },
    });

    if (existing) {
      if (existing.name.toLowerCase() === name.toLowerCase()) {
        throw new ConflictException(`Designation with name "${name}" already exists`);
      }
      code = `${code.substring(0, 4)}${Math.floor(10 + Math.random() * 90)}`;
    }

    const upperName = name.toUpperCase();
    let crmMobileAccess = false;
    if (dto.crmMobileAccess !== undefined) {
      crmMobileAccess = Boolean(dto.crmMobileAccess);
    } else if (upperName.includes('TELE') || upperName.includes('BPO')) {
      crmMobileAccess = true;
    }

    const created = await this.prisma.designation.create({
      data: {
        
        name,
        code,
        departmentId: dto.departmentId || null,
        description: dto.description?.trim() || null,
        level: dto.level !== undefined ? dto.level : 1,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
        crmMobileAccess,
        audience: dto.audience === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE',
      },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });

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
      crmMobileAccess: Boolean(created.crmMobileAccess),
      status: created.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async update(customerId: number | string, id: number, dto: UpdateDesignationDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const existing = await this.prisma.designation.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Designation #${id} not found`);
    }

    if (dto.departmentId !== undefined && dto.departmentId !== null) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId },
      });
      if (!dept) {
        throw new BadRequestException(`Department #${dto.departmentId} does not exist`);
      }
    }

    if (dto.name) {
      const duplicateName = await this.prisma.designation.findFirst({
        where: {
          
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
        crmMobileAccess: dto.crmMobileAccess !== undefined ? Boolean(dto.crmMobileAccess) : undefined,
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
      crmMobileAccess: Boolean(updated.crmMobileAccess),
      status: updated.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async remove(customerId: number | string, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const designation = await this.prisma.designation.findFirst({
      where: { id },
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

  /**
   * Seed standard designations if customer has 0 designations,
   * seamlessly linking existing DB roles (preserving permissions) and assigning demo employee.
   */
  async seedInitialDesignationsIfEmpty(customerId: number): Promise<void> {
    try {
      const count = await this.prisma.designation.count({ where: {  } });
      if (count > 0) return;

      this.logger.log(`[DESIGNATIONS] Seeding initial designations for customer #${customerId}`);

      const standardDesignations = [
        { name: 'Telecaller', code: 'TELECL', level: 1, description: 'Client calling & lead verification' },
        { name: 'Designer', code: 'DSGNR', level: 2, description: 'Graphic & visual design' },
        { name: 'Editor', code: 'EDITOR', level: 2, description: 'Video editing & motion graphics' },
        { name: 'Social Media Manager', code: 'SMM', level: 2, description: 'Social media management & strategy' },
        { name: 'Photographer', code: 'PHOTO', level: 2, description: 'On-site photo & video shoots' },
        { name: 'Sales Executive', code: 'SALES', level: 2, description: 'Client acquisition & sales closing' },
        { name: 'HR', code: 'HR', level: 2, description: 'Human resources & personnel' },
        { name: 'Manager', code: 'MGR', level: 3, description: 'Team operations manager' },
      ];

      for (const item of standardDesignations) {
        let desig = await this.prisma.designation.findFirst({
          where: {
            
            name: { equals: item.name, mode: 'insensitive' },
          },
        });

        if (!desig) {
          desig = await this.prisma.designation.create({
            data: {
              
              name: item.name,
              code: item.code,
              level: item.level,
              description: item.description,
              isActive: true,
            },
          });
        }
      }

      // Link any existing unassigned employee in this customer to Telecaller
      const telecallerDesig = await this.prisma.designation.findFirst({
        where: {  name: { equals: 'Telecaller', mode: 'insensitive' } },
      });
      if (telecallerDesig) {
        await this.prisma.employee.updateMany({
          where: {  designationId: null },
          data: { designationId: telecallerDesig.id },
        });
      }
    } catch (err) {
      this.logger.warn(`[DESIGNATIONS] Failed seeding initial designations: ${err}`);
    }
  }

  async ensureRoleForDesignation(designation: { id: number; name: string; customerId?: number; description?: string | null; audience?: string | null }) {
    return null;
  }

  async ensureCustomerAppDesignation(customerId: number) {
    let designation = await this.prisma.designation.findFirst({
      where: {  code: 'CUSTOMER' },
    });

    if (!designation) {
      designation = await this.prisma.designation.create({
        data: {
          name: 'Customer',
          code: 'CUSTOMER',
          level: 0,
          description: 'Customer mobile app access',
          isActive: true,
          crmMobileAccess: false,
          audience: 'CUSTOMER',
        },
      });
    } else if (designation.audience !== 'CUSTOMER') {
      designation = await this.prisma.designation.update({
        where: { id: designation.id },
        data: { audience: 'CUSTOMER' },
      });
    }

    return designation;
  }
}
