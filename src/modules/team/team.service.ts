import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTeamDto, AddTeamMemberDto } from './dto/team.dto';

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId: string) {
    return this.prisma.team.findMany({
      where: { customerId, isActive: true },
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

  async findOne(customerId: string, id: string) {
    const team = await this.prisma.team.findFirst({
      where: { id, customerId },
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

  async create(customerId: string, dto: CreateTeamDto) {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          customerId,
          name: dto.name,
          description: dto.description,
          leaderId: dto.leaderId,
        },
      });

      if (dto.memberIds && dto.memberIds.length > 0) {
        await tx.teamMember.createMany({
          data: dto.memberIds.map((empId) => ({
            teamId: team.id,
            employeeId: empId,
          })),
          skipDuplicates: true,
        });
      }

      return team;
    });
  }

  async addMember(teamId: string, dto: AddTeamMemberDto) {
    return this.prisma.teamMember.upsert({
      where: {
        teamId_employeeId: {
          teamId,
          employeeId: dto.employeeId,
        },
      },
      update: { role: dto.role || 'MEMBER' },
      create: {
        teamId,
        employeeId: dto.employeeId,
        role: dto.role || 'MEMBER',
      },
    });
  }

  async removeMember(teamId: string, employeeId: string) {
    return this.prisma.teamMember.delete({
      where: {
        teamId_employeeId: {
          teamId,
          employeeId,
        },
      },
    });
  }
}
