import { Test, TestingModule } from '@nestjs/testing';
import { WorkStatus, WorkType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkPermissionService } from './work-permission.service';
import { WorkService } from './work.service';

describe('Production team assignment', () => {
  function freshWorks() {
    return [
      { id: 1, customerId: 8, teamId: null as number | null, assignedToId: null as number | null, status: WorkStatus.SCHEDULED, workType: WorkType.EDITING, title: 'Edit' },
      { id: 2, customerId: 8, teamId: null as number | null, assignedToId: null as number | null, status: WorkStatus.SCHEDULED, workType: WorkType.SHOOT, title: 'Shoot' },
      { id: 3, customerId: 8, teamId: null as number | null, assignedToId: null as number | null, status: WorkStatus.SCHEDULED, workType: WorkType.POST_DESIGN, title: 'Post' },
      { id: 4, customerId: 8, teamId: null as number | null, assignedToId: null as number | null, status: WorkStatus.SCHEDULED, workType: WorkType.UPLOADING, title: 'Upload' },
      { id: 5, customerId: 8, teamId: null as number | null, assignedToId: null as number | null, status: WorkStatus.SCHEDULED, workType: WorkType.STORY_DESIGN, title: 'Story' },
    ];
  }

  function member(id: number, designation: string) {
    return {
      employeeId: id,
      employee: {
        id,
        customerId: 1,
        status: 'ACTIVE',
        firstName: designation,
        lastName: 'User',
        designation: { name: designation },
        department: { name: 'Production' },
      },
    };
  }

  const productionMembers = [
    member(10, 'Video Editor'),
    member(11, 'Graphic Designer'),
    member(12, 'Senior Photographer'),
    member(13, 'Social Media Manager'),
    member(14, 'Production Manager'),
    member(15, 'Telecaller'),
  ];

  async function sync(team: { id: number; name: string; members: any[] }, works: any[] = freshWorks()) {
    const updates: any[] = [];
    const prisma: any = {
      team: {
        findUnique: jest.fn().mockResolvedValue({
          id: team.id,
          name: team.name,
          description: '',
          customerId: 1,
          leader: null,
          members: team.members,
        }),
      },
      work: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) =>
          works.filter((work) => {
            if (where?.customerId != null && work.customerId !== where.customerId) return false;
            return work.assignedToId == null || work.teamId == null || work.teamId !== team.id;
          }),
        ),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          const work = works.find((item) => item.id === where.id);
          Object.assign(work, data);
          updates.push({ id: where.id, ...data });
          return work;
        }),
      },
      workTask: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
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
              allowedTypes: new Set<string>(),
              isFullAccess: false,
              isProductionManager: false,
              workPermissions: [],
            }),
          },
        },
      ],
    }).compile();
    await module.get(WorkService).syncCustomerTeamWorkAssignments(8, team.id);
    return { updates, prisma, works };
  }

  it('assigns each production schedule to the matching designation only', async () => {
    const { updates } = await sync({ id: 2, name: 'Production Team_A', members: productionMembers });
    const assignee = (id: number) => updates.find((item) => item.id === id)?.assignedToId;

    expect(assignee(1)).toBe(10);
    expect(assignee(2)).toBe(12);
    expect(assignee(3)).toBe(11);
    expect(assignee(4)).toBe(13);
    expect(assignee(5)).toBe(11);
    expect(updates.map((item) => item.assignedToId)).not.toContain(14);
    expect(updates.map((item) => item.assignedToId)).not.toContain(15);
    expect(new Set(updates.map((item) => item.id)).size).toBe(updates.length);
  });

  it('does not assign BPO team members to production schedules', async () => {
    const { updates } = await sync({
      id: 1,
      name: 'BPO Team',
      members: [member(15, 'Telecaller')],
    });
    expect(updates.every((item) => item.assignedToId == null)).toBe(true);
    expect(updates.every((item) => item.teamId === 1)).toBe(true);
  });

  it('assigns open production schedules when that employee opens the calendar', async () => {
    const prisma: any = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          userId: 110,
          customerId: 1,
          firstName: 'Video',
          lastName: 'Editor',
          designation: { name: 'Video Editor' },
          department: { name: 'Production' },
        }),
        findFirst: jest.fn().mockResolvedValue({ id: 10, userId: 110, customerId: 1, status: 'ACTIVE' }),
      },
      teamMember: {
        findMany: jest.fn().mockResolvedValue([
          { teamId: 2, team: { customerId: 1, isActive: true, name: 'Production Team_A', description: '' } },
        ]),
      },
      team: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      customer: {
        findMany: jest.fn().mockResolvedValue([{ id: 8, assignedTeamId: 2 }]),
      },
      work: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: WorkPermissionService,
          useValue: {
            getAllowedActivityTypesForEmployee: jest.fn().mockResolvedValue({
              role: 'VIDEO EDITOR',
              allowedTypes: new Set<string>(),
              isFullAccess: false,
              isProductionManager: false,
              workPermissions: [],
            }),
          },
        },
      ],
    }).compile();
    const service = module.get(WorkService);
    const assign = jest.spyOn(service, 'syncCustomerTeamWorkAssignments').mockResolvedValue(1);

    await service.getEmployeeCalendar(10, { month: 10, year: 2026 }, { allTenantCustomers: true });

    expect(assign).toHaveBeenCalledWith(8, 2);
  });

  it('gives customer video-editing tasks to the Video Editor, not a Videographer', async () => {
    const works = [
      { id: 1, customerId: 8, teamId: null as number | null, assignedToId: null as number | null, status: WorkStatus.SCHEDULED, workType: WorkType.EDITING, title: 'Reel #1: Edit', description: 'Reel #1 Video Editing, Color Grading & Audio Sync' },
      { id: 2, customerId: 8, teamId: null as number | null, assignedToId: null as number | null, status: WorkStatus.SCHEDULED, workType: WorkType.VIDEO_EDITING, title: 'Reel #2: Edit', description: 'Reel #2 Video Editing' },
      { id: 3, customerId: 9, teamId: null as number | null, assignedToId: null as number | null, status: WorkStatus.SCHEDULED, workType: WorkType.EDITING, title: 'Other tenant edit' },
    ];
    const { updates, prisma } = await sync(
      {
        id: 2,
        name: 'Production Team_A',
        members: [member(16, 'Videographer'), member(10, 'Video Editor'), member(11, 'Graphic Designer')],
      },
      works,
    );
    const assignee = (id: number) => updates.find((item) => item.id === id)?.assignedToId;
    expect(assignee(1)).toBe(10);
    expect(assignee(2)).toBe(10);
    expect(updates.find((item) => item.id === 3)).toBeUndefined();
    expect(updates.map((item) => item.assignedToId)).not.toContain(16);
    expect(updates.map((item) => item.assignedToId)).not.toContain(11);
    expect(prisma.workTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workId: 1, assignedToId: null },
        data: { assignedToId: 10 },
      }),
    );
  });

  it('does not create a second schedule when assignment runs again', async () => {
    const works = freshWorks();
    const team = { id: 2, name: 'Production Team_A', members: productionMembers };
    await sync(team, works);
    const second = await sync(team, works);
    expect(second.updates).toEqual([]);
    expect(second.prisma.work.update).not.toHaveBeenCalled();
  });
});
