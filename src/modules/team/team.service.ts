import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AddTeamMemberDto,
  CreateTeamDto,
  TeamQueryDto,
  UpdateTeamDto,
} from './dto/team.dto';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { normalizeActivityType } from '../work/work-permission.service';

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  private get employeeSelect() {
    return {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      gender: true,
      status: true,
      designationId: true,
      departmentId: true,
      designation: {
        select: {
          id: true,
          name: true,
        },
      },
      department: {
        select: {
          id: true,
          name: true,
        },
      },
    };
  }

  private formatEmployee(emp: any) {
    if (!emp) return null;
    return {
      ...emp,
      name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.firstName || 'Staff',
    };
  }

  private formatTeam(team: any) {
    if (!team) return null;
    return {
      ...team,
      status: team.isActive ? 'ACTIVE' : 'INACTIVE',
      leader: this.formatEmployee(team.leader),
      members: (team.members || []).map((m: any) => ({
        ...m,
        employee: this.formatEmployee(m.employee),
      })),
      memberCount: team.members?.length || 0,
    };
  }

  async findAll(customerId?: number | string, query?: TeamQueryDto) {
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (customerId !== undefined && customerId !== null && String(customerId).trim() !== '') {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId) || numCustomerId <= 0) {
        throw new BadRequestException('Invalid customer ID provided');
      }
      where.customerId = numCustomerId;
    }

    if (query?.status === 'ACTIVE') {
      where.isActive = true;
    } else if (query?.status === 'INACTIVE') {
      where.isActive = false;
    }

    if (query?.search && query.search.trim()) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        {
          leader: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { employeeCode: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
        {
          members: {
            some: {
              employee: {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } },
                  { employeeCode: { contains: search, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
      ];
    }

    const [rawItems, total] = await Promise.all([
      this.prisma.team.findMany({
        where,
        include: {
          leader: {
            select: this.employeeSelect,
          },
          members: {
            include: {
              employee: {
                select: this.employeeSelect,
              },
            },
            orderBy: { joinedAt: 'asc' },
          },
          _count: {
            select: {
              members: true,
              works: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.team.count({ where }),
    ]);

    const items = rawItems.map((t) => this.formatTeam(t));
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: items,
      items,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
      },
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async findOne(customerId: number | string | undefined, id: number | string) {
    const numId = Number(id);
    if (isNaN(numId) || numId <= 0) {
      throw new BadRequestException('Valid Team ID is required');
    }

    const where: any = { id: numId };
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        where.customerId = numCustomerId;
      }
    }

    const team = await this.prisma.team.findFirst({
      where,
      include: {
        leader: {
          select: this.employeeSelect,
        },
        members: {
          include: {
            employee: {
              select: this.employeeSelect,
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
        works: {
          take: 10,
          orderBy: { scheduledDate: 'desc' },
        },
        _count: {
          select: {
            members: true,
            works: true,
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException(`Team with ID ${id} not found`);
    }

    return this.formatTeam(team);
  }

  async create(customerId: number | string | undefined, dto: CreateTeamDto) {
    const numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new BadRequestException('Valid Customer ID is required to create a team');
    }

    // 1. Validate Leader if supplied
    if (dto.leaderId) {
      const leader = await this.prisma.employee.findFirst({
        where: { id: Number(dto.leaderId), customerId: numCustomerId },
      });
      if (!leader) {
        throw new BadRequestException('Designated team leader does not exist or belong to your organization');
      }
    }

    // 2. Validate Members if supplied
    const uniqueMemberIds = dto.memberIds
      ? Array.from(new Set(dto.memberIds.map((m) => Number(m))))
      : [];

    if (uniqueMemberIds.length > 0) {
      const validEmployees = await this.prisma.employee.findMany({
        where: {
          id: { in: uniqueMemberIds },
          customerId: numCustomerId,
        },
        select: { id: true },
      });

      if (validEmployees.length !== uniqueMemberIds.length) {
        throw new BadRequestException('One or more selected team members do not exist or belong to another organization');
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          customerId: numCustomerId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          leaderId: dto.leaderId ? Number(dto.leaderId) : null,
          isActive: dto.isActive !== undefined ? dto.isActive : true,
        },
      });

      if (uniqueMemberIds.length > 0) {
        await tx.teamMember.createMany({
          data: uniqueMemberIds.map((empId) => ({
            teamId: team.id,
            employeeId: empId,
            role: empId === Number(dto.leaderId) ? 'LEADER' : 'MEMBER',
          })),
          skipDuplicates: true,
        });
      }

      return tx.team.findUnique({
        where: { id: team.id },
        include: {
          leader: { select: this.employeeSelect },
          members: {
            include: { employee: { select: this.employeeSelect } },
          },
        },
      });
    });

    return this.formatTeam(created);
  }

  async update(customerId: number | string | undefined, id: number | string, dto: UpdateTeamDto) {
    const numId = Number(id);
    const where: any = { id: numId };
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        where.customerId = numCustomerId;
      }
    }

    // 1. Verify Team existence
    const existing = await this.prisma.team.findFirst({ where });
    if (!existing) {
      throw new NotFoundException(`Team with ID ${id} not found in your organization`);
    }

    const targetCustomerId = existing.customerId;

    // 2. Validate Leader if changing
    if (dto.leaderId !== undefined && dto.leaderId !== null) {
      const leader = await this.prisma.employee.findFirst({
        where: { id: Number(dto.leaderId), customerId: targetCustomerId },
      });
      if (!leader) {
        throw new BadRequestException('Designated team leader does not exist or belong to your organization');
      }
    }

    // 3. Validate Members if changing
    let uniqueMemberIds: number[] | null = null;
    if (dto.memberIds !== undefined) {
      uniqueMemberIds = Array.from(new Set(dto.memberIds.map((m) => Number(m))));
      if (uniqueMemberIds.length > 0) {
        const validEmployees = await this.prisma.employee.findMany({
          where: {
            id: { in: uniqueMemberIds },
            customerId: targetCustomerId,
          },
          select: { id: true },
        });

        if (validEmployees.length !== uniqueMemberIds.length) {
          throw new BadRequestException('One or more selected team members do not exist or belong to another organization');
        }
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updateData: any = {};
      if (dto.name !== undefined) updateData.name = dto.name.trim();
      if (dto.description !== undefined) updateData.description = dto.description?.trim() || null;
      if (dto.leaderId !== undefined) updateData.leaderId = dto.leaderId ? Number(dto.leaderId) : null;
      if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

      await tx.team.update({
        where: { id: numId },
        data: updateData,
      });

      if (uniqueMemberIds !== null) {
        // Sync members: delete removed and insert new
        await tx.teamMember.deleteMany({
          where: {
            teamId: numId,
            employeeId: { notIn: uniqueMemberIds },
          },
        });

        if (uniqueMemberIds.length > 0) {
          await tx.teamMember.createMany({
            data: uniqueMemberIds.map((empId) => ({
              teamId: numId,
              employeeId: empId,
              role: empId === Number(dto.leaderId ?? existing.leaderId) ? 'LEADER' : 'MEMBER',
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.team.findUnique({
        where: { id: numId },
        include: {
          leader: { select: this.employeeSelect },
          members: {
            include: { employee: { select: this.employeeSelect } },
          },
        },
      });
    });

    return this.formatTeam(updated);
  }

  async remove(customerId: number | string | undefined, id: number | string, permanent = false) {
    const numId = Number(id);
    const where: any = { id: numId };
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        where.customerId = numCustomerId;
      }
    }

    const team = await this.prisma.team.findFirst({ where });
    if (!team) {
      throw new NotFoundException(`Team with ID ${id} not found in your organization`);
    }

    if (permanent) {
      await this.prisma.team.delete({
        where: { id: numId },
      });
      return { success: true, message: `Team "${team.name}" permanently deleted` };
    }

    await this.prisma.team.update({
      where: { id: numId },
      data: { isActive: false },
    });

    return { success: true, message: `Team "${team.name}" deactivated successfully` };
  }

  async addMember(customerId: number | string | undefined, teamId: number | string, dto: AddTeamMemberDto) {
    const numTeamId = Number(teamId);
    const numEmployeeId = Number(dto.employeeId);

    const where: any = { id: numTeamId };
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        where.customerId = numCustomerId;
      }
    }

    const team = await this.prisma.team.findFirst({ where });
    if (!team) {
      throw new NotFoundException(`Team with ID ${teamId} not found in your organization`);
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: numEmployeeId, customerId: team.customerId },
    });
    if (!employee) {
      throw new BadRequestException('Employee does not exist or belong to your organization');
    }

    const member = await this.prisma.teamMember.upsert({
      where: {
        teamId_employeeId: {
          teamId: numTeamId,
          employeeId: numEmployeeId,
        },
      },
      update: { role: dto.role || 'MEMBER' },
      create: {
        teamId: numTeamId,
        employeeId: numEmployeeId,
        role: dto.role || 'MEMBER',
      },
      include: {
        employee: {
          select: this.employeeSelect,
        },
      },
    });

    return {
      ...member,
      employee: this.formatEmployee(member.employee),
    };
  }

  async removeMember(customerId: number | string | undefined, teamId: number | string, employeeId: number | string) {
    const numTeamId = Number(teamId);
    const numEmployeeId = Number(employeeId);

    const where: any = { id: numTeamId };
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        where.customerId = numCustomerId;
      }
    }

    const team = await this.prisma.team.findFirst({ where });
    if (!team) {
      throw new NotFoundException(`Team with ID ${teamId} not found in your organization`);
    }

    return this.prisma.teamMember.delete({
      where: {
        teamId_employeeId: {
          teamId: numTeamId,
          employeeId: numEmployeeId,
        },
      },
    });
  }

  async resolveEmployeeIdForUser(user: any): Promise<number | null> {
    if (!user) return null;
    if (user.employee?.id) return Number(user.employee.id);
    if (user.employeeId) return Number(user.employeeId);

    const rawId = Number(user.id);
    const email = user.email ? String(user.email).trim().toLowerCase() : undefined;
    const phone = user.phone ? String(user.phone).trim() : undefined;

    const orConditions: any[] = [];
    if (!isNaN(rawId) && rawId > 0) {
      orConditions.push({ userId: rawId });
      orConditions.push({ id: rawId });
    }
    if (email) {
      orConditions.push({ email: { equals: email, mode: 'insensitive' } });
    }
    if (phone) {
      orConditions.push({ phone });
    }

    if (orConditions.length === 0) return null;

    const employee = await this.prisma.employee.findFirst({
      where: { OR: orConditions },
      select: { id: true },
    });
    return employee?.id ?? null;
  }

  async getMyTeams(user: any, customerId?: number | string) {
    const employeeId = await this.resolveEmployeeIdForUser(user);
    const where: any = {};

    if (customerId) {
      const numCust = Number(customerId);
      if (!isNaN(numCust) && numCust > 0) {
        where.customerId = numCust;
      }
    }

    const isSuperAdmin = isUserSuperAdmin(user);
    const userRoles = Array.isArray(user?.roles) ? user.roles : [user?.role].filter(Boolean);
    const isAdmin = isSuperAdmin || userRoles.some((r: string) =>
      typeof r === 'string' && (r.toUpperCase().includes('ADMIN') || r.toUpperCase().includes('MANAGER'))
    );

    if (!isAdmin && employeeId) {
      where.OR = [
        { leaderId: employeeId },
        { members: { some: { employeeId } } },
      ];
    }

    const teams = await this.prisma.team.findMany({
      where,
      include: {
        leader: { select: this.employeeSelect },
        members: {
          include: {
            employee: { select: this.employeeSelect },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return teams.map((t) => this.formatTeam(t));
  }

  async getTeamCalendar(
    teamId: number | string,
    query: {
      startDate?: string;
      endDate?: string;
      date?: string;
      scheduledDate?: string;
      dateFrom?: string;
      dateTo?: string;
      month?: number | string;
      year?: number | string;
      status?: string;
      customerId?: number | string;
    } = {},
    user?: any,
    customerId?: number | string,
  ) {
    const logger = new Logger('TeamService:getTeamCalendar');
    const numTeamId = Number(teamId);
    if (isNaN(numTeamId) || numTeamId <= 0) {
      throw new BadRequestException('Invalid team ID');
    }

    const team = await this.prisma.team.findUnique({
      where: { id: numTeamId },
      include: {
        leader: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: { select: { id: true, name: true } },
          },
        },
        members: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException(`Team with ID ${teamId} not found`);
    }

    const where: any = {
      OR: [
        { teamId: numTeamId },
        { customer: { assignedTeamId: numTeamId } },
      ],
    };

    if (query.status && query.status.toUpperCase() !== 'ALL') {
      where.status = query.status;
    } else {
      where.status = { not: 'CANCELLED' };
    }

    let targetYear: number | undefined;
    let targetMonth: number | undefined;
    let targetDay: number | undefined;
    let targetDateStr: string | undefined;

    const explicitDate = query.date || query.scheduledDate;
    const explicitStart = query.startDate || query.dateFrom;
    const explicitEnd = query.endDate || query.dateTo;

    if (explicitDate) {
      targetDateStr = explicitDate.includes('T') ? explicitDate.split('T')[0] : explicitDate.split(' ')[0];
      const parts = targetDateStr.split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        targetYear = parts[0];
        targetMonth = parts[1];
        targetDay = parts[2];
        const d = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay));
        const startWindow = new Date(d.getTime() - 24 * 60 * 60 * 1000);
        const endWindow = new Date(d.getTime() + 24 * 60 * 60 * 1000);
        where.scheduledDate = { gte: startWindow, lte: endWindow };
      }
    } else if (query.month && query.year) {
      targetYear = Number(query.year);
      targetMonth = Number(query.month);
      const startOfMonth = new Date(Date.UTC(targetYear, targetMonth - 1, 0, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(targetYear, targetMonth, 2, 23, 59, 59, 999));
      where.scheduledDate = { gte: startOfMonth, lte: endOfMonth };
    } else if (explicitStart || explicitEnd) {
      where.scheduledDate = {};
      if (explicitStart) {
        where.scheduledDate.gte = new Date(new Date(explicitStart).getTime() - 24 * 60 * 60 * 1000);
      }
      if (explicitEnd) {
        const toDate = new Date(explicitEnd);
        toDate.setHours(23, 59, 59, 999);
        where.scheduledDate.lte = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    const works = await this.prisma.work.findMany({
      where,
      orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }],
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            companyName: true,
            address: true,
            city: true,
            state: true,
            assignedTeamId: true,
            assignedTeam: { select: { id: true, name: true } },
            socialMediaHandlers: {
              take: 5,
              select: { platform: true, accountName: true, accountUrl: true, status: true },
            },
          },
        },
        team: {
          select: { id: true, name: true },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: { select: { id: true, name: true } },
          },
        },
        editor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: { select: { id: true, name: true } },
          },
        },
        subscription: {
          select: {
            id: true,
            plan: { select: { name: true } },
          },
        },
        tasks: {
          select: { id: true, title: true, status: true, stepOrder: true, assignedToId: true, notes: true, createdAt: true },
          orderBy: { stepOrder: 'asc' },
        },
      },
    });

    const matchesTargetDate = (dateVal: any, tY: number, tM: number, tD: number): boolean => {
      if (!dateVal) return false;
      const rawStr = typeof dateVal === 'string' ? dateVal : (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal));
      const datePart = rawStr.includes('T') ? rawStr.split('T')[0] : rawStr.split(' ')[0];
      const [sy, sm, sd] = datePart.split('-').map(Number);
      if (sy === tY && sm === tM && sd === tD) return true;

      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return false;

      if (d.getUTCFullYear() === tY && d.getUTCMonth() + 1 === tM && d.getUTCDate() === tD) return true;
      if (d.getFullYear() === tY && d.getMonth() + 1 === tM && d.getDate() === tD) return true;
      const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      if (istDate.getUTCFullYear() === tY && istDate.getUTCMonth() + 1 === tM && istDate.getUTCDate() === tD) return true;

      return false;
    };

    const matchesTargetMonth = (dateVal: any, tY: number, tM: number): boolean => {
      if (!dateVal) return false;
      const rawStr = typeof dateVal === 'string' ? dateVal : (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal));
      const datePart = rawStr.includes('T') ? rawStr.split('T')[0] : rawStr.split(' ')[0];
      const [sy, sm] = datePart.split('-').map(Number);
      if (sy === tY && sm === tM) return true;

      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return false;

      if (d.getUTCFullYear() === tY && d.getUTCMonth() + 1 === tM) return true;
      if (d.getFullYear() === tY && d.getMonth() + 1 === tM) return true;
      const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      if (istDate.getUTCFullYear() === tY && istDate.getUTCMonth() + 1 === tM) return true;

      return false;
    };

    const formatScheduleDate = (dateVal: any, explicitTarget?: string): string => {
      if (explicitTarget && /^\d{4}-\d{2}-\d{2}$/.test(explicitTarget)) {
        const [y, m, d] = explicitTarget.split('-').map(Number);
        if (matchesTargetDate(dateVal, y, m, d)) {
          return explicitTarget;
        }
      }
      if (!dateVal) return '';
      const rawStr = typeof dateVal === 'string' ? dateVal : (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal));
      const directPart = rawStr.includes('T') ? rawStr.split('T')[0] : rawStr.split(' ')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(directPart)) {
        return directPart;
      }
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return '';
      const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      const y = istDate.getUTCFullYear();
      const m = String(istDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(istDate.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    let filteredWorks = works;
    if (targetYear && targetMonth && targetDay) {
      filteredWorks = works.filter((w) => matchesTargetDate(w.scheduledDate, targetYear!, targetMonth!, targetDay!));
    } else if (targetYear && targetMonth) {
      filteredWorks = works.filter((w) => matchesTargetMonth(w.scheduledDate, targetYear!, targetMonth!));
    } else if (explicitStart || explicitEnd) {
      filteredWorks = works.filter((w) => {
        const dStr = formatScheduleDate(w.scheduledDate);
        if (explicitStart && dStr < explicitStart) return false;
        if (explicitEnd && dStr > explicitEnd) return false;
        return true;
      });
    }

    const mapped = filteredWorks.map((w) => {
      const normalizedType = normalizeActivityType(w);

      let assignedEmployeeObj: any = null;
      let assignedEmpName = 'Unassigned';

      if (w.assignedTo) {
        assignedEmpName = `${w.assignedTo.firstName || ''} ${w.assignedTo.lastName || ''}`.trim() || 'Staff';
        assignedEmployeeObj = {
          id: w.assignedTo.id,
          name: assignedEmpName,
          firstName: w.assignedTo.firstName,
          lastName: w.assignedTo.lastName,
          designation: w.assignedTo.designation?.name || null,
        };
      } else if (w.editor) {
        assignedEmpName = `${w.editor.firstName || ''} ${w.editor.lastName || ''}`.trim() || 'Staff';
        assignedEmployeeObj = {
          id: w.editor.id,
          name: assignedEmpName,
          firstName: w.editor.firstName,
          lastName: w.editor.lastName,
          designation: w.editor.designation?.name || null,
        };
      }

      const assignedEmpList: string[] = [];
      if (assignedEmpName && assignedEmpName !== 'Unassigned') {
        assignedEmpList.push(assignedEmpName);
      }

      const startTime = w.scheduledTime || '10:00 AM';
      const schedDateVal = formatScheduleDate(w.scheduledDate, targetDateStr);
      const custLocation = [w.customer?.address, w.customer?.city, w.customer?.state]
        .filter(Boolean)
        .join(', ') || null;

      const smHandler = w.customer?.socialMediaHandlers?.[0];
      const platform = smHandler?.platform || 'Instagram';
      const smAccount = smHandler?.accountName
        ? `${platform} — @${smHandler.accountName}`
        : (w.customer?.name ? `@${w.customer.name.toLowerCase().replace(/\s+/g, '')}` : 'Instagram');

      return {
        id: w.id,
        activityId: String(w.id),
        activityType: normalizedType,
        type: normalizedType,
        workType: w.workType,
        title: w.title,
        description: w.description || `${w.title} deliverable`,
        notes: w.description || `${w.title} deliverable`,
        scheduledDate: schedDateVal,
        scheduledTime: startTime,
        date: schedDateVal,
        time: startTime,
        startTime: startTime,
        status: w.status,
        customer: {
          id: w.customer?.id || w.customerId,
          name: w.customer?.name || 'Customer',
          companyName: w.customer?.companyName || w.customer?.name || 'Customer',
        },
        customerId: String(w.customerId),
        customerName: w.customer?.name || 'Customer',
        customerBusiness: w.customer?.companyName || w.customer?.name || 'Customer',
        team: {
          id: team.id,
          name: team.name,
        },
        assignedTeam: team.name,
        employee: assignedEmployeeObj,
        assignedEmployee: assignedEmpName,
        assignedToName: assignedEmpName,
        assignedEmployees: assignedEmpList,
        assignedToId: w.assignedToId,
        editorId: w.editorId,
        location: custLocation,
        socialMediaAccount: smAccount,
        platform: platform,
        tasks: w.tasks || [],
        durationDays: w.tasks?.length ? w.tasks.length : (w.workType === 'REEL' || w.workType === 'REELS_SHOOT' || w.workType === 'SHOOT' ? 3 : 1),
      };
    });

    // Logging per Requirement 13
    logger.log(`[TEAM_CALENDAR_DEBUG]
Team ID: ${numTeamId} (${team.name})
Calendar Start: ${explicitStart || `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`}
Calendar End: ${explicitEnd || `${targetYear}-${String(targetMonth).padStart(2, '0')}-30`}
API: /teams/${numTeamId}/calendar
Response count: ${mapped.length}`);

    return mapped;
  }
}
