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
import {
  STANDARD_PERMISSIONS,
  CUSTOMER_APP_PERMISSIONS,
  ROLE_PERMISSION_DEFAULTS,
  toPermissionKey,
  fromPermissionKey,
} from '../../common/constants/rbac.constants';
import { RoleType } from '@prisma/client';

@Injectable()
export class DesignationService {
  private readonly logger = new Logger(DesignationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => PlanScheduleGateway))
    private readonly planScheduleGateway: PlanScheduleGateway,
  ) {}

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

    const upperName = name.toUpperCase();
    let crmMobileAccess = false;
    if (dto.crmMobileAccess !== undefined) {
      crmMobileAccess = Boolean(dto.crmMobileAccess);
    } else if (upperName.includes('TELE') || upperName.includes('BPO')) {
      crmMobileAccess = true;
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
        crmMobileAccess,
        audience: dto.audience === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE',
      },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    // Auto-create / link the matching Role via ensureRoleForDesignation so that:
    // 1. The Role.designationId FK is properly set (the critical fix)
    // 2. Duplicate prevention is handled consistently
    // 3. GET /designations/roles and GET /designations/:id/permissions work immediately
    try {
      await this.ensureRoleForDesignation({
        id: created.id,
        name: created.name,
        customerId: numCustomerId,
        description: created.description,
        audience: dto.audience === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE',
      });
    } catch (roleErr) {
      this.logger.warn(`[DESIGNATION_CREATE] Could not auto-link Role for Designation #${created.id}: ${roleErr}`);
    }

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
        crmMobileAccess: dto.crmMobileAccess !== undefined ? Boolean(dto.crmMobileAccess) : undefined,
      },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    if (dto.isActive !== undefined || dto.name) {
      await this.prisma.role.updateMany({
        where: { designationId: id },
        data: {
          name: dto.name ? dto.name.trim() : undefined,
          deletedAt: dto.isActive !== undefined ? (dto.isActive ? null : new Date()) : undefined,
        },
      }).catch(() => null);
    }

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

    if (designation.code === 'CUSTOMER') {
      throw new BadRequestException('System default Customer role cannot be deleted.');
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

    const affectedCustomers = designation.audience === 'CUSTOMER'
      ? await this.prisma.customer.findMany({
          where: { mobileRoleId: id, deletedAt: null },
          select: { id: true },
        })
      : [];

    await this.prisma.designation.delete({ where: { id } });

    for (const cust of affectedCustomers) {
      this.planScheduleGateway.notifyCustomerPermissionsUpdated(cust.id);
    }

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
      const count = await this.prisma.designation.count({ where: { customerId } });
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
            customerId,
            name: { equals: item.name, mode: 'insensitive' },
          },
        });

        if (!desig) {
          desig = await this.prisma.designation.create({
            data: {
              customerId,
              name: item.name,
              code: item.code,
              level: item.level,
              description: item.description,
              isActive: true,
            },
          });
        }

        // Link to existing DB role if one matches this designation by name
        if (desig) {
          const upperName = item.name.toUpperCase().replace(/\s+/g, '_');
          const matchedRole = await this.prisma.role.findFirst({
            where: {
              OR: [
                { name: { equals: item.name, mode: 'insensitive' } },
                { name: { equals: upperName, mode: 'insensitive' } },
              ],
              designationId: null,
              name: { notIn: ['CUSTOMER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'] },
            },
          });

          if (matchedRole) {
            await this.prisma.role.update({
              where: { id: matchedRole.id },
              data: { designationId: desig.id },
            });
            this.logger.log(`[DESIGNATIONS] Linked Role #${matchedRole.id} (${matchedRole.name}) to Designation #${desig.id} (${desig.name})`);
          } else {
            await this.ensureRoleForDesignation(desig);
          }
        }
      }

      // Link any existing unassigned employee in this customer to Telecaller
      const telecallerDesig = await this.prisma.designation.findFirst({
        where: { customerId, name: { equals: 'Telecaller', mode: 'insensitive' } },
      });
      if (telecallerDesig) {
        await this.prisma.employee.updateMany({
          where: { customerId, designationId: null },
          data: { designationId: telecallerDesig.id },
        });
      }
    } catch (err) {
      this.logger.warn(`[DESIGNATIONS] Failed seeding initial designations: ${err}`);
    }
  }

  /**
   * Ensure a Role entity exists and is linked 1:1 with this Designation.
   */
  async ensureRoleForDesignation(designation: { id: number; name: string; customerId: number; description?: string | null; audience?: string | null }) {
    let role = await this.prisma.role.findUnique({
      where: { designationId: designation.id },
      include: {
        rolePermissions: { include: { permission: true } },
      },
    });

    if (role && role.rolePermissions && role.rolePermissions.length > 0) return role;

    if (!role) {
      // Check if a role exists with matching name that has no designation attached
      const upperName = designation.name.toUpperCase().replace(/\s+/g, '_');
      const existingUnlinked = await this.prisma.role.findFirst({
        where: {
          OR: [
            { name: { equals: designation.name, mode: 'insensitive' } },
            { name: { equals: upperName, mode: 'insensitive' } },
          ],
          designationId: null,
          name: { notIn: ['CUSTOMER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE'] },
        },
        include: {
          rolePermissions: { include: { permission: true } },
        },
      });

      if (existingUnlinked) {
        role = await this.prisma.role.update({
          where: { id: existingUnlinked.id },
          data: { designationId: designation.id },
          include: {
            rolePermissions: { include: { permission: true } },
          },
        });
      } else {
        // Otherwise create a new Role for this designation
        role = await this.prisma.role.create({
          data: {
            name: designation.name,
            description: designation.description || `${designation.name} role`,
            type: RoleType.CUSTOM,
            customerId: designation.customerId,
            designationId: designation.id,
          },
          include: {
            rolePermissions: { include: { permission: true } },
          },
        });
      }
    }

    if (role.rolePermissions && role.rolePermissions.length > 0) {
      return role;
    }

    // Seed default permissions for this role
    const upperName = designation.name.toUpperCase().replace(/\s+/g, '_');
    let defaultKeys: { module: string; action: string }[] = [];
    if (ROLE_PERMISSION_DEFAULTS[upperName]) {
      defaultKeys = ROLE_PERMISSION_DEFAULTS[upperName];
    } else if (upperName.includes('PRODUCTION')) {
      defaultKeys = ROLE_PERMISSION_DEFAULTS.PRODUCTION_TEAM_MEMBER || [];
    } else if (upperName.includes('DESIGNER')) {
      defaultKeys = ROLE_PERMISSION_DEFAULTS.DESIGNER || [];
    } else if (upperName.includes('EDITOR')) {
      defaultKeys = ROLE_PERMISSION_DEFAULTS.EDITOR || [];
    } else if (upperName.includes('SOCIAL') || upperName.includes('SMM')) {
      defaultKeys = ROLE_PERMISSION_DEFAULTS.SOCIAL_MEDIA_MANAGER || [];
    } else if (upperName.includes('PHOTO')) {
      defaultKeys = ROLE_PERMISSION_DEFAULTS.PHOTOGRAPHER || [];
    } else if (designation.audience === 'CUSTOMER') {
      defaultKeys = ROLE_PERMISSION_DEFAULTS.CUSTOMER || [];
    } else {
      defaultKeys = ROLE_PERMISSION_DEFAULTS.TELECALLER || [];
    }

    for (const p of defaultKeys) {
      let permRecord = await this.prisma.permission.findUnique({
        where: { module_action: { module: p.module, action: p.action } },
      });
      if (!permRecord) {
        permRecord = await this.prisma.permission.create({
          data: {
            module: p.module,
            action: p.action,
            description: `${p.action} permission for ${p.module}`,
          },
        });
      }
      if (permRecord) {
        await this.prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: permRecord.id },
        }).catch(() => null);
      }
    }

    return this.prisma.role.findUnique({
      where: { id: role.id },
      include: {
        rolePermissions: { include: { permission: true } },
      },
    });
  }

  /**
   * Fetch all roles directly derived from Employee Designations (single source of truth).
   */
  /**
   * Customer mobile role, stored as a designation so the existing
   * Roles & Permissions screen can edit it. Does not replace employee roles.
   */
  async ensureCustomerAppDesignation(customerId: number) {
    let designation = await this.prisma.designation.findFirst({
      where: { customerId, code: 'CUSTOMER' },
    });

    if (!designation) {
      designation = await this.prisma.designation.create({
        data: {
          customerId,
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

    const existingRole = await this.prisma.role.findUnique({
      where: { designationId: designation.id },
      include: { rolePermissions: true },
    });
    if (existingRole) return designation;

    const role = await this.prisma.role.create({
      data: {
        name: 'Customer',
        description: designation.description || 'Customer mobile app access',
        type: RoleType.CUSTOM,
        customerId,
        designationId: designation.id,
      },
    });

    for (const p of ROLE_PERMISSION_DEFAULTS.CUSTOMER || []) {
      let permRecord = await this.prisma.permission.findUnique({
        where: { module_action: { module: p.module, action: p.action } },
      });
      if (!permRecord) {
        permRecord = await this.prisma.permission.create({
          data: {
            module: p.module,
            action: p.action,
            description: `${p.action} permission for ${p.module}`,
          },
        });
      }
      await this.prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permRecord.id },
      }).catch(() => null);
    }

    return designation;
  }

  async getDesignationRoles(customerId: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    await this.seedInitialDesignationsIfEmpty(numCustomerId);
    await this.ensureCustomerAppDesignation(numCustomerId);

    let designations: any[];
    try {
      designations = await this.prisma.designation.findMany({
        where: { customerId: numCustomerId },
        include: {
          department: { select: { id: true, name: true, code: true } },
          role: {
            include: {
              rolePermissions: { include: { permission: true } },
            },
          },
          _count: {
            select: { employees: true, mobileCustomers: true },
          },
        },
        orderBy: [{ level: 'asc' }, { name: 'asc' }],
      });
    } catch {
      designations = await this.prisma.designation.findMany({
        where: { customerId: numCustomerId },
        include: {
          department: { select: { id: true, name: true, code: true } },
          role: {
            include: {
              rolePermissions: { include: { permission: true } },
            },
          },
          _count: {
            select: { employees: true },
          },
        },
        orderBy: [{ level: 'asc' }, { name: 'asc' }],
      });
    }

    const result = [];
    for (const d of designations) {
      let role = d.role;
      if (!role) {
        role = await this.ensureRoleForDesignation(d);
      }
      const perms = role?.rolePermissions || [];

      result.push({
        id: String(d.id),
        roleId: role ? String(role.id) : String(d.id),
        designationId: d.id,
        name: d.name,
        code: d.code,
        audience:
          d.audience === 'CUSTOMER' || String(d.code || '').toUpperCase() === 'CUSTOMER'
            ? 'CUSTOMER'
            : d.audience || 'EMPLOYEE',
        departmentName: d.department?.name || 'General',
        department: d.department,
        description: d.description || `${d.name} role`,
        permissionsCount: perms.length,
        usersCount: d.audience === 'CUSTOMER' || String(d.code || '').toUpperCase() === 'CUSTOMER'
          ? (d._count as any).mobileCustomers ?? 0
          : d._count.employees,
        isSystem: false,
        isActive: d.isActive,
        crmMobileAccess: Boolean(d.crmMobileAccess),
        permissionsUpdatedAt: role?.permissionsUpdatedAt || d.updatedAt,
        permissions: perms.map((rp) => ({
          module: rp.permission.module,
          action: rp.permission.action,
          key: toPermissionKey(rp.permission.module, rp.permission.action),
          description: rp.permission.description,
        })),
      });
    }

    return result;
  }

  /**
   * Get permissions for a specific Designation.
   */
  async getDesignationPermissions(customerId: number | string, designationId: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const designation = await this.prisma.designation.findFirst({
      where: { id: designationId, customerId: numCustomerId },
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: true } },
          },
        },
      },
    });

    if (!designation) {
      throw new NotFoundException(`Designation #${designationId} not found`);
    }

    let role = designation.role;
    if (!role) {
      role = await this.ensureRoleForDesignation(designation);
    }

    const perms = role?.rolePermissions || [];
    return {
      roleId: role?.id,
      designationId: designation.id,
      designationName: designation.name,
      crmMobileAccess: Boolean(designation.crmMobileAccess),
      permissionsCount: perms.length,
      permissionsUpdatedAt: role?.permissionsUpdatedAt,
      permissions: perms.map((rp) => ({
        module: rp.permission.module,
        action: rp.permission.action,
        key: toPermissionKey(rp.permission.module, rp.permission.action),
        description: rp.permission.description,
      })),
    };
  }

  /**
   * Save permissions for a specific Designation, updating the linked Role
   * and emitting real-time notification to all active employees assigned to this designation.
   */
  async saveDesignationPermissions(
    customerId: number | string,
    designationId: number,
    permissions: (string | { module?: string; action?: string; key?: string })[],
    adminUser?: any,
    crmMobileAccess?: boolean,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const designation = await this.prisma.designation.findFirst({
      where: { id: designationId, customerId: numCustomerId },
    });

    if (!designation) {
      throw new NotFoundException(`Designation #${designationId} not found`);
    }

    const role = await this.ensureRoleForDesignation(designation);
    if (!role) {
      throw new BadRequestException(`Could not resolve role for designation #${designationId}`);
    }

    // Normalize incoming permissions
    const normalizedList: { module: string; action: string }[] = [];
    const seen = new Set<string>();

    for (const item of permissions || []) {
      let m = '';
      let a = '';
      if (typeof item === 'string') {
        const parsed = fromPermissionKey(item);
        m = parsed.module;
        a = parsed.action;
      } else if (item && typeof item === 'object') {
        if (item.key) {
          const parsed = fromPermissionKey(item.key);
          m = parsed.module;
          a = parsed.action;
        } else if (item.module && item.action) {
          m = item.module.trim().toUpperCase();
          a = item.action.trim().toUpperCase();
        }
      }

      if (m && a) {
        const uniqueKey = `${m}:${a}`;
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          normalizedList.push({ module: m, action: a });
        }
      }
    }

    // Delete existing role permissions
    await this.prisma.rolePermission.deleteMany({
      where: { roleId: role.id },
    });

    // Ensure permissions exist and link
    for (const p of normalizedList) {
      let permRecord = await this.prisma.permission.findUnique({
        where: { module_action: { module: p.module, action: p.action } },
      });
      if (!permRecord) {
        const standardMatch =
          STANDARD_PERMISSIONS.find((sp) => sp.module === p.module && sp.action === p.action) ||
          CUSTOMER_APP_PERMISSIONS.find((cp) => cp.module === p.module && cp.action === p.action);
        permRecord = await this.prisma.permission.create({
          data: {
            module: p.module,
            action: p.action,
            description: standardMatch?.description || `${p.action} permission for ${p.module}`,
          },
        });
      }
      if (permRecord) {
        await this.prisma.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId: permRecord.id,
          },
        });
      }
    }

    // Update permissionsUpdatedAt timestamp on Role
    const now = new Date();
    await this.prisma.role.update({
      where: { id: role.id },
      data: { permissionsUpdatedAt: now },
    });

    // If crmMobileAccess is explicitly passed, update Designation
    if (crmMobileAccess !== undefined) {
      await this.prisma.designation.update({
        where: { id: designationId },
        data: { crmMobileAccess: Boolean(crmMobileAccess) },
      });
    }

    // Find all active employees assigned to this designation
    const activeEmployees = await this.prisma.employee.findMany({
      where: { designationId, status: 'ACTIVE' },
      select: { id: true },
    });

    const affectedEmployeeIds = activeEmployees.map((e) => e.id);

    // Update permissionsUpdatedAt on affected employees
    if (affectedEmployeeIds.length > 0) {
      await this.prisma.employee.updateMany({
        where: { id: { in: affectedEmployeeIds } },
        data: { permissionsUpdatedAt: now },
      });
    }

    // Emit real-time notification to affected employees via WebSocket
    this.planScheduleGateway.notifyDesignationPermissionsUpdated(designationId, affectedEmployeeIds);

    // If Customer role/designation, notify all affected customers via WebSocket
    if (designation.audience === 'CUSTOMER' || designation.code === 'CUSTOMER') {
      try {
        const affectedCustomers = await this.prisma.customer.findMany({
          where: {
            OR: [
              { mobileRoleId: designationId },
              ...(designation.code === 'CUSTOMER' ? [{ mobileRoleId: null }] : []),
            ],
            deletedAt: null,
          },
          select: { id: true },
        });
        for (const cust of affectedCustomers) {
          this.planScheduleGateway.notifyCustomerPermissionsUpdated(cust.id);
        }
      } catch (custErr) {
        this.logger.warn(`Failed to notify customers for designation #${designationId}: ${custErr}`);
      }
    }

    this.logger.log(
      `[RBAC_REALTIME] Designation #${designationId} (${designation.name}) updated with ${normalizedList.length} permissions. Notified ${affectedEmployeeIds.length} employees.`,
    );

    // Audit Log recording
    try {
      if (this.prisma?.auditLog?.create) {
        await this.prisma.auditLog.create({
          data: {
            customerId: numCustomerId,
            userId: adminUser?.id || adminUser?.userId || null,
            userName: adminUser?.firstName
              ? `${adminUser.firstName} ${adminUser.lastName || ''}`.trim()
              : adminUser?.email || 'Admin',
            userRole: adminUser?.role || 'ADMIN',
            source: 'ADMIN_PANEL',
            action: 'UPDATE',
            module: 'ROLES_PERMISSIONS',
            description: `Updated role permissions for Designation "${designation.name}" (${normalizedList.length} permissions)`,
            entityType: 'DesignationRolePermission',
            entityId: String(designation.id),
            details: {
              designationId: designation.id,
              designationName: designation.name,
              roleId: role.id,
              totalAssigned: normalizedList.length,
              affectedEmployeesCount: affectedEmployeeIds.length,
            },
          },
        });
      }
    } catch (auditErr) {
      this.logger.warn(`Failed to log audit for saveDesignationPermissions: ${auditErr}`);
    }

    return this.getDesignationPermissions(numCustomerId, designationId);
  }
}
