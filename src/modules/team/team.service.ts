import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTeamDto, AddTeamMemberDto } from './dto/team.dto';

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId?: number | string) {
    const numCustomerId = Number(customerId);
    const where: any = { isActive: true };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }
    return this.prisma.team.findMany({
      where,
      include: {
        members: {
          include: {
            employee: true,
          },
        },
        _count: {
          select: {
            works: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    const team = await this.prisma.team.findFirst({
      where: { id: numId, customerId: numCustomerId },
      include: {
        members: {
          include: {
            employee: true,
          },
        },
        works: {
          take: 10,
          orderBy: { scheduledDate: 'desc' },
        },
      },
    });

    if (!team) {
      throw new NotFoundException(`Team with ID ${id} not found`);
    }

    return team;
  }

  async create(customerId: number | string, dto: CreateTeamDto) {
    const numCustomerId = Number(customerId);
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          customerId: numCustomerId,
          name: dto.name,
          description: dto.description,
          leaderId: dto.leaderId ? Number(dto.leaderId) : null,
        },
      });

      if (dto.memberIds && dto.memberIds.length > 0) {
        await tx.teamMember.createMany({
          data: dto.memberIds.map((empId) => ({
            teamId: team.id,
            employeeId: Number(empId),
          })),
          skipDuplicates: true,
        });
      }

      return team;
    });
  }

  async addMember(teamId: number | string, dto: AddTeamMemberDto) {
    const numTeamId = Number(teamId);
    const numEmployeeId = Number(dto.employeeId);
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
    });
  }

  async removeMember(teamId: number | string, employeeId: number | string) {
    const numTeamId = Number(teamId);
    const numEmployeeId = Number(employeeId);
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
