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
  ];

  function work(id: number, workType: WorkType, assignedToId: number | null, customerId: number) {
    return {
      id,
      customerId,
      teamId: null,
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
        assignedTeamId: null,
        assignedEmployeeId: null,
      },
      team: null,
      assignedTo: null,
      editor: null,
      tasks: [],
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
    if (condition.customer?.assignedTeam) return false;
    if (condition.customer?.assignedEmployeeId !== undefined) return false;
    if (condition.tasks) return false;
    if (condition.teamId || condition.team) return false;
    return false;
  }

  async function serviceFor(employee: { id: number; designation: string }) {
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
      teamMember: { findMany: jest.fn().mockResolvedValue([]) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn().mockResolvedValue([]) },
      work: {
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
              allowedTypes: new Set<string>(),
              isFullAccess: false,
              isProductionManager: false,
              workPermissions: [],
            }),
          },
        },
      ],
    }).compile();
    return module.get(WorkService);
  }

  async function idsFor(designation: string, id: number) {
    const service = await serviceFor({ id, designation });
    const calendar = await service.getEmployeeCalendar(id, { month: 10, year: 2026 }, { allTenantCustomers: true });
    return calendar.map((item) => item.id);
  }

  it('shows a Reel Editor and a Video Editor only matching editing work', async () => {
    await expect(idsFor('Reel Editor', 10)).resolves.toEqual(['1', '2']);
    await expect(idsFor('Video Editor', 11)).resolves.toEqual(['1', '2']);
  });

  it('shows a Reel Shooter only shoot work and keeps the original date', async () => {
    const service = await serviceFor({ id: 12, designation: 'Reel Shooter' });
    const calendar = await service.getEmployeeCalendar(12, { month: 10, year: 2026 }, { allTenantCustomers: true });
    expect(calendar.map((item) => item.id)).toEqual(['3']);
    expect(calendar[0].scheduledDate).toBe('2026-10-12');
    expect(works.find((item) => item.id === 3)?.assignedToId).toBeNull();
  });

  it('shows a Graphic Designer only design work', async () => {
    await expect(idsFor('Graphic Designer', 13)).resolves.toEqual(['4']);
  });

  it('hides every category from a telecaller and from another tenant', async () => {
    await expect(idsFor('Telecaller', 14)).resolves.toEqual([]);
    const service = await serviceFor({ id: 10, designation: 'Video Editor' });
    const calendar = await service.getEmployeeCalendar(10, { month: 10, year: 2026 }, { allTenantCustomers: true });
    expect(calendar.find((item) => item.id === '6')).toBeUndefined();
    expect(calendar.find((item) => item.id === '5')).toBeUndefined();
  });
});
