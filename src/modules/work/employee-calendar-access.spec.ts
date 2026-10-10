import { Test, TestingModule } from '@nestjs/testing';
import { WorkStatus, WorkType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkPermissionService } from './work-permission.service';
import { WorkService } from './work.service';
import { WorkController } from './work.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import * as request from 'supertest';

describe('Employee calendar team and assignment regressions', () => {
  let workService: WorkService;
  let testingModule: TestingModule;

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
      return condition.assignedToId?.in ? condition.assignedToId.in.includes(item.assignedToId) : item.assignedToId === condition.assignedToId;
    }
    if (condition.editorId !== undefined && condition.editorId !== null) {
      return condition.editorId?.in ? condition.editorId.in.includes(item.editorId) : item.editorId === condition.editorId;
    }
    if (condition.tasks?.some?.assignedToId !== undefined) {
      const ids = condition.tasks.some.assignedToId;
      return item.tasks.some((task: any) => ids?.in ? ids.in.includes(task.assignedToId) : task.assignedToId === ids);
    }
    if (condition.customer?.assignedEmployeeId !== undefined) {
      const ids = condition.customer.assignedEmployeeId;
      return ids?.in ? ids.in.includes(item.customer?.assignedEmployeeId) : item.customer?.assignedEmployeeId === ids;
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
    works.splice(3);
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
      controllers: [WorkController],
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
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true }).compile();
    testingModule = module;

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
  it('keeps every active team assignment regardless of designation or another assignee', async () => {
    const calendar = await workService.getEmployeeCalendar(5, { month: 10, year: 2026 }, { assignedOnly: true });
    expect(calendar.map((item) => item.id)).toEqual(expect.arrayContaining(['801', '804', '806', '807']));
    expect(calendar.find((item) => item.id === '803')).toBeUndefined();
  });

  it('shows Senior Photographer all reel shoots for team-allotted customers, including other assignees', async () => {
    const prisma = testingModule.get(PrismaService) as any;
    const permissions = testingModule.get(WorkPermissionService) as any;
    prisma.employee.findUnique.mockResolvedValue({
      id: 1, userId: 2, customerId: 1, status: 'ACTIVE',
      designation: { name: 'Senior Photographer' },
    });
    permissions.getAllowedActivityTypesForEmployee.mockResolvedValue({
      role: 'SENIOR PHOTOGRAPHER',
      allowedTypes: new Set(['REEL_SHOOT']),
      isFullAccess: false,
      isProductionManager: false,
      workPermissions: ['reel_shoot'],
    });
    works.push({
      ...teamWork, id: 910, customerId: 40, assignedToId: 9,
      workType: WorkType.SHOOT,
      customer: { ...teamWork.customer, id: 40 },
    });
    const calendar = await workService.getEmployeeCalendar(1, { month: 10, year: 2026 }, { assignedOnly: true });
    expect(calendar.map((item) => item.id)).toEqual(expect.arrayContaining(['801', '910']));
    expect(calendar.some((item) => item.id === '803')).toBe(false);
  });

  it('returns customer schedule 2775 to a team member on October 11 even when assigned to Employee 2', async () => {
    // Reproduce the supplied customer response. Team 7 is a fixture membership,
    // not an assertion about the production team's numeric ID.
    works.push({
      ...teamWork,
      id: 2775,
      customerId: 100,
      assignedToId: 2,
      workType: WorkType.SHOOT,
      title: 'Reel #1: Shoot',
      scheduledDate: new Date('2026-10-11T10:00:00.000Z'),
      scheduledTime: '10:00 AM',
      status: WorkStatus.ASSIGNED,
      assignedTo: { id: 2, firstName: 'Super', lastName: 'Admin' },
      customer: {
        ...teamWork.customer,
        id: 100,
        name: 'Friends Factory Cafe - Rooftop Candle Light Dinner',
        assignedTeamId: 7,
      },
    });
    const day = await workService.getEmployeeCalendar(1, { date: '2026-10-11' }, { assignedOnly: true });
    expect(day.find((item) => item.id === '2775')).toMatchObject({
      customerId: '100',
      title: 'Reel #1: Shoot',
      scheduledDate: '2026-10-11',
      startTime: '10:00 AM',
      workType: 'SHOOT',
      status: 'ASSIGNED',
    });
    const previousDay = await workService.getEmployeeCalendar(1, { date: '2026-10-10' }, { assignedOnly: true });
    expect(previousDay.some((item) => item.id === '2775')).toBe(false);
    const month = await workService.getEmployeeCalendar(1, { month: 10, year: 2026 }, { assignedOnly: true });
    expect(month.some((item) => item.id === '2775')).toBe(true);
  });

  it('does not grant team visibility from a direct assignment without membership', async () => {
    works.push({ ...directWork, id: 808, assignedToId: 4, teamId: 99 });
    const calendar = await workService.getEmployeeCalendar(4, { month: 10, year: 2026 }, { assignedOnly: true });
    expect(calendar.map((item) => item.id)).toEqual(['808']);
  });

  it('does not confuse a matching User.id with another Employee.id', async () => {
    works.push({ ...directWork, id: 809, assignedToId: 2 });
    const calendar = await workService.getEmployeeCalendar(1, {}, { assignedOnly: true });
    expect(calendar.find((item) => item.id === '809')).toBeUndefined();
  });

  it.each([
    { customerId: 1, isActive: false },
    { customerId: 99, isActive: true },
  ])('excludes inactive or foreign-company membership: %j', async (team) => {
    const prisma = testingModule.get(PrismaService) as any;
    prisma.teamMember.findMany.mockResolvedValue([{ teamId: 7, team }]);
    const calendar = await workService.getEmployeeCalendar(1, {}, { assignedOnly: true });
    expect(calendar.map((item) => item.id)).toEqual(['802']);
  });

  it("does not expose a manager's unrelated general tasks in My Calendar", async () => {
    const permissions = testingModule.get(WorkPermissionService) as any;
    permissions.getAllowedActivityTypesForEmployee.mockResolvedValue({
      role: 'PRODUCTION_MANAGER', allowedTypes: new Set(), isFullAccess: true, isProductionManager: true,
    });
    const prisma = testingModule.get(PrismaService) as any;
    await workService.getEmployeeCalendar(1, {}, { assignedOnly: true });
    expect(prisma.task.findMany.mock.calls[0][0].where.OR).toEqual([
      { employeeId: 1 }, { assignedToId: 2 },
      { customer: { assignedTeamId: { in: [7] } } },
    ]);
  });

  it('includes tasks for every team-allotted customer even when assigned to another member', async () => {
    const prisma = testingModule.get(PrismaService) as any;
    const rows = [30, 31, 32].map((customerId, index) => ({
      id: 900 + index,
      customerId,
      employeeId: 9,
      assignedToId: 19,
      title: `Customer ${customerId} task`,
      dueDate: new Date('2026-10-12T00:00:00.000Z'),
      status: 'PENDING',
      customer: { id: customerId, name: `Customer ${customerId}`, assignedTeamId: index < 2 ? 7 : 99 },
    }));
    prisma.task.findMany.mockImplementation(({ where }: any) => rows.filter((row) =>
      where.OR.some((condition: any) =>
        condition.employeeId === row.employeeId ||
        condition.assignedToId === row.assignedToId ||
        condition.customer?.assignedTeamId?.in?.includes(row.customer.assignedTeamId),
      ),
    ));
    const calendar = await workService.getEmployeeCalendar(1, { date: '2026-10-12' }, { assignedOnly: true });
    expect(calendar.map((item) => item.id)).toEqual(expect.arrayContaining(['900', '901']));
    expect(calendar.map((item) => item.id)).not.toContain('902');

    prisma.teamMember.findMany.mockResolvedValue([]);
    const withoutMembership = await workService.getEmployeeCalendar(1, { date: '2026-10-12' }, { assignedOnly: true });
    expect(withoutMembership.map((item) => item.id)).not.toEqual(expect.arrayContaining(['900', '901']));
  });

  it('returns non-empty customer-wise data through the existing HTTP endpoint', async () => {
    const log = jest.spyOn((workService as any).logger, 'log');
    jest.spyOn(workService, 'onModuleInit').mockImplementation(() => undefined);
    const app = testingModule.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 2, role: 'EMPLOYEE', employee: { id: 1, customerId: 1 } };
      next();
    });
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/works/employee/calendar?month=10&year=2026')
        .expect(200);
      expect(response.body.success).toBe(true);
      const debug = log.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith('[EMPLOYEE_CALENDAR_DEBUG]'));
      expect(debug).toEqual(expect.stringContaining('authUserId=2 resolvedEmployeeId=1'));
      expect(debug).toEqual(expect.stringContaining('membershipTeams=7'));
      expect(debug).toEqual(expect.stringContaining('directWorkCount=1 teamWorkCount=0 customerWorkCount=4'));
      expect(debug).toEqual(expect.stringContaining('finalCount=5'));
      expect(response.body.data.map((item: any) => item.id)).toEqual(expect.arrayContaining(['801', '802']));
      expect(response.body.data.find((item: any) => item.id === '803')).toBeUndefined();
      expect(response.body.data.find((item: any) => item.id === '801')).toMatchObject({
        customerId: '30', customerName: 'Allotted Client', scheduledDate: '2026-10-12',
      });
    } finally {
      await app.close();
    }
  });

});
