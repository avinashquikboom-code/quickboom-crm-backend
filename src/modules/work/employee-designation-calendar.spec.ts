import { Test, TestingModule } from '@nestjs/testing';
import { WorkStatus, WorkType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkPermissionService } from './work-permission.service';
import { WorkService } from './work.service';

describe('Employee designation calendar visibility', () => {
  const scheduled = new Date('2026-10-12T04:30:00.000Z');
  const works = [
    work(1, WorkType.EDITING, null, 1),
    work(2, WorkType.VIDEO_EDITING, null, 1),
    work(3, WorkType.SHOOT, null, 1),
    work(4, WorkType.POST_DESIGN, null, 1),
    work(5, WorkType.EDITING, 99, 1),
    work(6, WorkType.EDITING, null, 2),
    work(7, WorkType.EDITING, null, 50, { id: 2, customerId: 1, isActive: true }),
    work(8, WorkType.SHOOT, null, 50, { id: 2, customerId: 1, isActive: true }),
    work(9, WorkType.POST_DESIGN, null, 50, { id: 2, customerId: 1, isActive: true }),
    work(10, WorkType.UPLOADING, null, 50, { id: 2, customerId: 1, isActive: true }),
    work(11, WorkType.EDITING, null, 60, undefined, { customerId: 1, deletedAt: null }),
    work(12, WorkType.SHOOT, 11, 1),
    work(13, WorkType.CONTENT_WRITING, null, 1, undefined, undefined, {
      tasks: [{ id: 1, assignedToId: 21 }],
    }),
    work(14, WorkType.EDITING, 22, 90, undefined, undefined, {
      teamId: 2,
      team: { id: 2, name: 'Production Team', members: [{ employeeId: 22 }], leaderId: null },
    }),
    work(15, WorkType.EDITING, null, 90, undefined, undefined, {
      teamId: 2,
      team: { id: 2, name: 'Production Team', members: [{ employeeId: 23 }], leaderId: null },
    }),
  ];

  function work(
    id: number,
    workType: WorkType,
    assignedToId: number | null,
    customerId: number,
    assignedTeam?: { id: number; customerId: number; isActive: boolean },
    originLead?: { customerId: number; deletedAt: null },
    extras?: { tasks?: Array<{ id: number; assignedToId: number }>; teamId?: number; team?: any },
  ) {
    return {
      id,
      customerId,
      teamId: extras?.teamId ?? null,
      assignedToId,
      editorId: null,
      workType,
      title: workType,
      scheduledDate: scheduled,
      scheduledTime: '10:00 AM',
      status: WorkStatus.SCHEDULED,
      customer: {
        id: customerId,
        name: customerId === 1 ? 'Client' : 'Other tenant',
        deletedAt: null,
        isActive: true,
        assignedTeamId: assignedTeam?.id ?? null,
        assignedTeam: assignedTeam ?? null,
        originLead: originLead ?? null,
        assignedEmployeeId: null,
      },
      team: extras?.team ?? null,
      assignedTo: null,
      editor: null,
      tasks: extras?.tasks ?? [],
      entitlement: null,
      subscription: null,
    };
  }

  function matches(item: any, condition: any): boolean {
    if (condition.AND) return condition.AND.every((part: any) => matches(item, part));
    if (condition.OR) return condition.OR.some((part: any) => matches(item, part));
    if (condition.workType?.in) return condition.workType.in.includes(item.workType);
    if (condition.customerId !== undefined) return item.customerId === condition.customerId;
    if (condition.assignedToId === null) return item.assignedToId == null;
    if (condition.editorId === null) return item.editorId == null;
    if (typeof condition.assignedToId === 'number') return item.assignedToId === condition.assignedToId;
    if (typeof condition.editorId === 'number') return item.editorId === condition.editorId;
    if (condition.customer?.assignedTeam?.customerId !== undefined) {
      const team = item.customer?.assignedTeam;
      if (!team || team.customerId !== condition.customer.assignedTeam.customerId) return false;
      if (condition.customer.assignedTeam.isActive === true && team.isActive === false) return false;
      return true;
    }
    if (condition.customer?.assignedTeamId?.in) {
      return condition.customer.assignedTeamId.in.includes(item.customer?.assignedTeamId);
    }
    if (condition.customer?.originLead?.customerId !== undefined) {
      const lead = item.customer?.originLead;
      return Boolean(
        lead &&
        lead.deletedAt == null &&
        lead.customerId === condition.customer.originLead.customerId,
      );
    }
    if (condition.customer?.leads) return false;
    if (condition.customer?.assignedEmployeeRel || condition.customer?.createdByEmployeeRel) return false;
    if (condition.customer?.assignedEmployeeId !== undefined) return false;
    if (condition.tasks?.some?.assignedToId !== undefined) {
      return (item.tasks || []).some(
        (task: any) => task.assignedToId === condition.tasks.some.assignedToId,
      );
    }
    if (condition.teamId?.in) return condition.teamId.in.includes(item.teamId);
    if (typeof condition.teamId === 'number') return item.teamId === condition.teamId;
    if (condition.team?.members?.some?.employeeId !== undefined) {
      return (item.team?.members || []).some(
        (member: any) => member.employeeId === condition.team.members.some.employeeId,
      );
    }
    if (condition.team?.leaderId !== undefined) return item.team?.leaderId === condition.team.leaderId;
    if (condition.team?.id?.in) return condition.team.id.in.includes(item.team?.id);
    return false;
  }

  async function serviceFor(
    employee: { id: number; designation: string },
    options?: { allowedTypes?: string[]; teamIds?: number[] },
  ) {
    const prisma: any = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: employee.id,
          userId: employee.id + 100,
          customerId: 1,
          firstName: 'A',
          lastName: 'B',
          designation: { name: employee.designation },
          department: { name: 'Production' },
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: employee.id,
          userId: employee.id + 100,
          customerId: 1,
          status: 'ACTIVE',
        }),
      },
      teamMember: {
        findMany: jest.fn().mockResolvedValue(
          (options?.teamIds || []).map((teamId) => ({
            teamId,
            team: { name: 'Production Team', description: null, customerId: 1, isActive: true },
          })),
        ),
      },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn().mockResolvedValue([]) },
      work: {
        update: jest.fn(),
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          return works.filter((item) => {
            if (where?.status?.not && item.status === where.status.not) return false;
            if (where?.OR && !where.OR.some((condition: any) => matches(item, condition))) return false;
            return true;
          });
        }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: WorkPermissionService,
          useValue: {
            getAllowedActivityTypesForEmployee: jest.fn().mockResolvedValue({
              role: 'EMPLOYEE',
              allowedTypes: new Set<string>(options?.allowedTypes || []),
              isFullAccess: false,
              isProductionManager: false,
              workPermissions: [],
            }),
          },
        },
      ],
    }).compile();
    return { service: module.get(WorkService), prisma };
  }

  async function idsFor(designation: string, id: number) {
    const { service } = await serviceFor({ id, designation });
    const calendar = await service.getEmployeeCalendar(id, { month: 10, year: 2026 }, { allTenantCustomers: true });
    return calendar.map((item) => item.id);
  }

  it('shows a Reel Editor and a Video Editor only matching editing work', async () => {
    await expect(idsFor('Reel Editor', 10)).resolves.toEqual(['1', '2', '7', '11']);
    const { service } = await serviceFor({ id: 11, designation: 'Video Editor' });
    const calendar = await service.getEmployeeCalendar(11, { month: 10, year: 2026 }, { allTenantCustomers: true });
    const week = await service.getEmployeeCalendar(11, {
      dateFrom: '2026-10-10',
      dateTo: '2026-10-16',
    }, { allTenantCustomers: true });
    const metrics = await service.getProductionMetrics(11, { month: 10, year: 2026 }, { allTenantCustomers: true });
    expect(calendar.map((item) => item.id)).toEqual(['1', '2', '7', '11', '12']);
    expect(week.map((item) => item.id)).toEqual(calendar.map((item) => item.id));
    expect(metrics.total).toBe(calendar.length);
    expect(calendar.find((item) => item.id === '6')).toBeUndefined();
  });

  it('does not give video-editing tasks to a videographer', async () => {
    await expect(idsFor('Videographer', 16)).resolves.toEqual(['3', '8']);
  });

  it('shows a Reel Shooter only shoot work and keeps the original date', async () => {
    const { service, prisma } = await serviceFor({ id: 12, designation: 'Reel Shooter' });
    const calendar = await service.getEmployeeCalendar(12, { month: 10, year: 2026 }, { allTenantCustomers: true });
    expect(calendar.map((item) => item.id)).toEqual(['3', '8']);
    expect(calendar[0].scheduledDate).toBe('2026-10-12');
    expect(works.find((item) => item.id === 3)?.assignedToId).toBeNull();
    expect(prisma.work.update).not.toHaveBeenCalled();
  });

  it('shows a Graphic Designer only design work', async () => {
    await expect(idsFor('Graphic Designer', 13)).resolves.toEqual(['4', '9']);
  });

  it('shows a Social Media Manager only uploading work', async () => {
    await expect(idsFor('Social Media Manager', 15)).resolves.toEqual(['10']);
  });

  it('hides every category from a telecaller and from another tenant', async () => {
    await expect(idsFor('Telecaller', 14)).resolves.toEqual([]);
    const { service } = await serviceFor({ id: 10, designation: 'Video Editor' });
    const calendar = await service.getEmployeeCalendar(10, { month: 10, year: 2026 }, { allTenantCustomers: true });
    expect(calendar.find((item) => item.id === '6')).toBeUndefined();
    expect(calendar.find((item) => item.id === '5')).toBeUndefined();
  });

  it('uses role permissions when the designation text is only Production', async () => {
    const { service } = await serviceFor(
      { id: 30, designation: 'Production' },
      { allowedTypes: ['EDITING', 'VIDEO_EDITING', 'REEL_EDIT'] },
    );
    const calendar = await service.getEmployeeCalendar(30, { month: 10, year: 2026 }, { allTenantCustomers: true });
    expect(calendar.map((item) => item.id)).toEqual(['1', '2', '7', '11']);
  });

  it('shows an assigned work task on the month, the day, and a week, and hides other dates', async () => {
    const { service } = await serviceFor({ id: 21, designation: 'Telecaller' });
    const month = await service.getEmployeeCalendar(21, { month: 10, year: 2026 }, { allTenantCustomers: true });
    expect(month.map((item) => item.id)).toEqual(['13']);
    const day = await service.getEmployeeCalendar(21, { date: '2026-10-12' }, { allTenantCustomers: true });
    expect(day.map((item) => item.id)).toEqual(['13']);
    const week = await service.getEmployeeCalendar(21, {
      date: '2026-10-10',
      dateFrom: '2026-10-10',
      dateTo: '2026-10-16',
    }, { allTenantCustomers: true });
    expect(week.map((item) => item.id)).toEqual(['13']);
    const otherDay = await service.getEmployeeCalendar(21, { date: '2026-10-11' }, { allTenantCustomers: true });
    expect(otherDay).toEqual([]);
    const laterWeek = await service.getEmployeeCalendar(21, {
      dateFrom: '2026-11-01',
      dateTo: '2026-11-07',
    }, { allTenantCustomers: true });
    expect(laterWeek).toEqual([]);
  });

  it('shows a team member that team schedule and hides another tenant and another assignee', async () => {
    const { service } = await serviceFor(
      { id: 23, designation: 'Video Editor' },
      { teamIds: [2] },
    );
    const calendar = await service.getEmployeeCalendar(23, { month: 10, year: 2026 }, { allTenantCustomers: true });
    expect(calendar.map((item) => item.id)).toEqual(['1', '2', '7', '8', '9', '10', '11', '15']);
    const assigned = await serviceFor({ id: 22, designation: 'Video Editor' });
    const own = await assigned.service.getEmployeeCalendar(22, { month: 10, year: 2026 }, { allTenantCustomers: true });
    expect(own.map((item) => item.id)).toEqual(['1', '2', '7', '11', '14']);
    expect(own.find((item) => item.id === '6')).toBeUndefined();
  });
});
