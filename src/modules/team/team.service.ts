import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AddTeamMemberDto,
  CreateTeamDto,
  TeamQueryDto,
  UpdateTeamDto,
} from './dto/team.dto';

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
}
