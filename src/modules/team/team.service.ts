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
      name: true,
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

  async findAll(customerId: number | string, query?: TeamQueryDto) {
    const numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new BadRequestException('Valid Customer ID is required');
    }

    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {
      customerId: numCustomerId,
    };

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
              { name: { contains: search, mode: 'insensitive' } },
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
                  { name: { contains: search, mode: 'insensitive' } },
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

    const items = rawItems.map((team) => ({
      ...team,
      status: team.isActive ? 'ACTIVE' : 'INACTIVE',
      memberCount: team.members?.length || 0,
    }));

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

  async findOne(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new BadRequestException('Valid Customer ID is required');
    }

    const team = await this.prisma.team.findFirst({
      where: {
        id: numId,
        customerId: numCustomerId,
      },
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
      throw new NotFoundException(`Team with ID ${id} not found in your organization`);
    }

    return {
      ...team,
      status: team.isActive ? 'ACTIVE' : 'INACTIVE',
      memberCount: team.members?.length || 0,
    };
  }

  async create(customerId: number | string, dto: CreateTeamDto) {
    const numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new BadRequestException('Valid Customer ID is required');
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

    return this.prisma.$transaction(async (tx) => {
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
  }

  async update(customerId: number | string, id: number | string, dto: UpdateTeamDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    // 1. Verify Team existence
    const existing = await this.prisma.team.findFirst({
      where: { id: numId, customerId: numCustomerId },
    });

    if (!existing) {
      throw new NotFoundException(`Team with ID ${id} not found in your organization`);
    }

    // 2. Validate Leader if changing
    if (dto.leaderId !== undefined && dto.leaderId !== null) {
      const leader = await this.prisma.employee.findFirst({
        where: { id: Number(dto.leaderId), customerId: numCustomerId },
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
            customerId: numCustomerId,
          },
          select: { id: true },
        });

        if (validEmployees.length !== uniqueMemberIds.length) {
          throw new BadRequestException('One or more selected team members do not exist or belong to another organization');
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
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
  }

  async remove(customerId: number | string, id: number | string, permanent = false) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    const team = await this.prisma.team.findFirst({
      where: { id: numId, customerId: numCustomerId },
    });

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

  async addMember(customerId: number | string, teamId: number | string, dto: AddTeamMemberDto) {
    const numCustomerId = Number(customerId);
    const numTeamId = Number(teamId);
    const numEmployeeId = Number(dto.employeeId);

    const team = await this.prisma.team.findFirst({
      where: { id: numTeamId, customerId: numCustomerId },
    });
    if (!team) {
      throw new NotFoundException(`Team with ID ${teamId} not found in your organization`);
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: numEmployeeId, customerId: numCustomerId },
    });
    if (!employee) {
      throw new BadRequestException('Employee does not exist or belong to your organization');
    }

    return this.prisma.teamMember.upsert({
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
  }

  async removeMember(customerId: number | string, teamId: number | string, employeeId: number | string) {
    const numCustomerId = Number(customerId);
    const numTeamId = Number(teamId);
    const numEmployeeId = Number(employeeId);

    const team = await this.prisma.team.findFirst({
      where: { id: numTeamId, customerId: numCustomerId },
    });
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
