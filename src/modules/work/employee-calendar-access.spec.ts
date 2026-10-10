import { Test, TestingModule } from '@nestjs/testing';
import { WorkStatus, WorkType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkPermissionService } from './work-permission.service';
import { WorkService } from './work.service';

describe('Employee calendar team and assignment regressions', () => {
  let workService: WorkService;

  const teamWork = {
    id: 801,
    customerId: 30,
    teamId: null,
    assignedToId: null,
    editorId: null,
    workType: WorkType.REELS_SHOOT,
    title: 'Team customer shoot',
    scheduledDate: new Date('2026-10-12T00:00:00.000Z'),
    scheduledTime: '11:00 AM',
    status: WorkStatus.SCHEDULED,
    customer: {
      id: 30,
      name: 'Allotted Client',
      deletedAt: null,
      isActive: true,
      assignedTeamId: 7,
      assignedEmployeeId: null,
    },
    team: null,
    assignedTo: null,
    editor: null,
    tasks: [],
    entitlement: { serviceName: 'Reels' },
    subscription: { id: 1, plan: { name: 'Plan' } },
  };

  const directWork = {
    ...teamWork,
    id: 802,
    title: 'Direct assignment',
    assignedToId: 1,
    customer: {
      ...teamWork.customer,
      id: 31,
      name: 'Direct Client',
      assignedTeamId: null,
    },
    customerId: 31,
  };

  const otherWork = {
    ...teamWork,
    id: 803,
    title: 'Other employee',
    assignedToId: 9,
    customer: {
      ...teamWork.customer,
      id: 32,
      name: 'Other Client',
      assignedTeamId: 99,
    },
    customerId: 32,
  };

  const works: any[] = [teamWork, directWork, otherWork];

  function matches(item: any, condition: any): boolean {
    if (condition.assignedToId !== undefined && condition.assignedToId !== null) {
      return item.assignedToId === condition.assignedToId;
    }
    if (condition.editorId !== undefined && condition.editorId !== null) {
      return item.editorId === condition.editorId;
    }
    if (condition.tasks?.some?.assignedToId !== undefined) {
      return item.tasks.some((task: any) => task.assignedToId === condition.tasks.some.assignedToId);
    }
    if (condition.customer?.assignedEmployeeId !== undefined) {
      return item.customer?.assignedEmployeeId === condition.customer.assignedEmployeeId;
    }
    if (condition.teamId?.in) {
      return condition.teamId.in.includes(item.teamId);
    }
    if (condition.customer?.assignedTeamId?.in) {
      return (
        item.customer?.deletedAt == null &&
        item.customer?.isActive !== false &&
        condition.customer.assignedTeamId.in.includes(item.customer.assignedTeamId)
      );
    }
    return false;
  }

  beforeEach(async () => {
    const prisma: any = {
      employee: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 1) return { id: 1, userId: 2, customerId: 1, status: 'ACTIVE', firstName: 'Demo', lastName: 'Employee' };
          if (where.id === 4) return { id: 4, userId: 8, customerId: 1, status: 'ACTIVE', firstName: 'Other', lastName: 'Person' };
          return null;
        }),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.userId === 2) return { id: 1, userId: 2 };
          if (where.employeeCode?.equals === 'QB-EMP-019' && where.customerId === 1) return { id: 30, userId: 40 };
          if (where.id === 2) return { id: 2, userId: 3 };
          if (where.id === 1) return { id: 1, userId: 2, customerId: 1, status: 'ACTIVE' };
          return null;
        }),
      },
      teamMember: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          if (where.employeeId === 1 || where.employeeId?.in?.includes(1)) {
            return [{ teamId: 7, team: { customerId: 1, isActive: true, name: 'Production Team', description: '' } }];
          }
          return [];
        }),
      },
      team: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      customer: {
        findMany: jest.fn().mockResolvedValue([{ id: 30, assignedTeamId: 7 }]),
      },
      work: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          return works.filter((item) => {
            if (where?.status?.not && item.status === where.status.not) return false;
            if (where?.OR && !where.OR.some((condition: any) => matches(item, condition))) return false;
            return true;
          });
        }),
      },
      task: {
        findMany: jest.fn().mockResolvedValue([]),
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
              role: 'STAFF',
              allowedTypes: new Set(['REEL_SHOOT']),
              isFullAccess: true,
              isProductionManager: false,
              workPermissions: [],
            }),
          },
        },
      ],
    }).compile();

    const videoEditWork = {
      ...teamWork,
      id: 804,
      title: 'Reel Edit Unassigned',
      workType: WorkType.VIDEO_EDITING,
      scheduledDate: new Date('2026-10-15T00:00:00.000Z'),
    };

    const directEditorWork = {
      ...teamWork,
      id: 806,
      title: 'Editor Direct Assignment',
      workType: WorkType.VIDEO_EDITING,
      editorId: 5,
      scheduledDate: new Date('2026-10-16T00:00:00.000Z'),
    };

    const otherEditorWork = {
      ...teamWork,
      id: 807,
      title: 'Other Employee Edit',
      workType: WorkType.VIDEO_EDITING,
      editorId: 99,
      scheduledDate: new Date('2026-10-17T00:00:00.000Z'),
    };

    works.push(videoEditWork, directEditorWork, otherEditorWork);

    prisma.employee.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === 1) return { id: 1, userId: 2, customerId: 1, status: 'ACTIVE', firstName: 'Demo', lastName: 'Employee' };
      if (where.id === 4) return { id: 4, userId: 8, customerId: 1, status: 'ACTIVE', firstName: 'Other', lastName: 'Person' };
      if (where.id === 5) return { id: 5, userId: 10, customerId: 1, status: 'ACTIVE', firstName: 'Video', lastName: 'Editor' };
      return null;
    });

    prisma.teamMember.findMany.mockImplementation(({ where }: any) => {
      if (where.employeeId === 1 || where.employeeId?.in?.includes(1) || where.employeeId === 5 || where.employeeId?.in?.includes(5)) {
        return [{ teamId: 7, team: { customerId: 1, isActive: true, name: 'Production Team', description: '' } }];
      }
      return [];
    });

    const workPermService = module.get(WorkPermissionService);
    jest.spyOn(workPermService, 'getAllowedActivityTypesForEmployee').mockImplementation(async (empId: any) => {
      if (empId === 5) {
        return {
          role: 'VIDEO EDITOR',
          allowedTypes: new Set(['REEL_EDIT', 'VIDEO_EDITING']),
          isFullAccess: false,
          isProductionManager: false,
          workPermissions: ['video_edit'],
        };
      }
      return {
        role: 'STAFF',
        allowedTypes: new Set(['REEL_SHOOT']),
        isFullAccess: true,
        isProductionManager: false,
        workPermissions: [],
      };
    });

    workService = module.get(WorkService);
  });

  it('resolves User 2 to Employee 1 when Employee 2 shares that numeric id', async () => {
    const employeeId = await workService.resolveEmployeeIdForUser({ id: 2 });
    expect(employeeId).toBe(1);
  });

  it('resolves employee code QB-EMP-019 to Employee.id and does not use the code or User.id as Employee.id', async () => {
    const byCode = await workService.resolveEmployeeIdForUser({
      id: 19,
      customerId: 1,
      employeeCode: 'QB-EMP-019',
    });
    expect(byCode).toBe(30);
    const linked = await workService.resolveEmployeeIdForUser({
      id: 19,
      employee: { id: 30, employeeCode: 'QB-EMP-019', userId: 40 },
    });
    expect(linked).toBe(30);
  });

  it('keeps unassigned team work in the current month when the request has no date', async () => {
    const calendar = await workService.getEmployeeCalendar(1, {}, { assignedOnly: true });
    expect(calendar.map((item) => item.id)).toEqual(expect.arrayContaining(['801', '802']));
    expect(calendar.find((item) => item.id === '803')).toBeUndefined();
  });
  it('shows work for a customer allotted to the employee team', async () => {
    const calendar = await workService.getEmployeeCalendar(1, { month: 10, year: 2026 }, { assignedOnly: true });
    expect(calendar.map((item) => item.id)).toEqual(expect.arrayContaining(['801', '802']));
    expect(calendar.find((item) => item.id === '801')?.customerName).toBe('Allotted Client');
    expect(calendar.find((item) => item.id === '803')).toBeUndefined();
  });

  it('does not show unassigned editing work to an editor who is not on that team', async () => {
    const calendar = await workService.getEmployeeCalendar(4, { month: 10, year: 2026 }, {
      allTenantCustomers: true,
    });
    expect(calendar.find((item) => item.id === '802')).toBeUndefined();
    expect(calendar.find((item) => item.id === '801')).toBeUndefined();
  });
  it('shows a direct assignment and hides another employee work', async () => {
    const calendar = await workService.getEmployeeCalendar(4, { date: '2026-10-12' }, { assignedOnly: true });
    expect(calendar).toEqual([]);
  });

  it('returns the same team work from My Work metrics and the calendar', async () => {
    const calendar = await workService.getEmployeeCalendar(1, { month: 10, year: 2026 }, {
      allTenantCustomers: false,
      assignedOnly: true,
    });
    const metrics = await workService.getProductionMetrics(1, { month: 10, year: 2026 }, {
      allTenantCustomers: false,
      assignedOnly: true,
    });
    expect(metrics.total).toBe(calendar.length);
    expect(metrics.total).toBeGreaterThan(0);
  });

  it('allows Video Editor to see eligible editing work and direct assignments, but hides unrelated employee tasks and shoots', async () => {
    const calendar = await workService.getEmployeeCalendar(5, { month: 10, year: 2026 }, {
      allTenantCustomers: true,
      assignedOnly: false,
    });
    const ids = calendar.map((c) => c.id);

    // Eligible unassigned edit task on team: YES
    expect(ids).toContain('804');
    // Direct assignment to editor: YES
    expect(ids).toContain('806');
    // Unassigned shoot on team (ineligible for Video Editor): NO
    expect(ids).not.toContain('801');
    // Edit assigned to another employee on team: NO (unrelated employee activity)
    expect(ids).not.toContain('807');
    // Work on another team: NO
    expect(ids).not.toContain('803');

    // Metrics consistency:
    const metrics = await workService.getProductionMetrics(5, { month: 10, year: 2026 }, {
      allTenantCustomers: true,
      assignedOnly: false,
    });
    expect(metrics.total).toBe(calendar.length);
    expect(metrics.total).toBe(2);
  });
});
