import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { WorkPermissionService } from './work-permission.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionStatus, TaskStatus, WorkStatus } from '@prisma/client';

/**
 * A customer converted from a lead is owned by the sales / BPO employee who won it.
 * Their calendar tasks must go to the production team, like they do for a customer who signs up
 * in the app, otherwise the production employees never see them.
 */
describe('Lead-converted customer: calendar task assignment', () => {
  let service: WorkService;
  let prisma: any;

  const SALES_OWNER = {
    id: 2,
    designation: { name: 'TELESALES EXECUTIVE' },
    department: { name: 'BPO CALL CENTER' },
    user: { userRoles: [{ role: { name: 'SUPER_ADMIN' } }] },
  };
  const PRODUCTION_OWNER = {
    id: 30,
    designation: { name: 'ACCOUNT MANAGER' },
    department: { name: 'PRODUCTION' },
    user: { userRoles: [{ role: { name: 'EMPLOYEE' } }] },
  };
  const member = (id: number, designation: string) => ({
    employeeId: id,
    role: 'MEMBER',
    employee: { id, firstName: 'E', lastName: String(id), designation: { name: designation }, department: { name: 'PRODUCTION' } },
  });
  const TEAM = {
    id: 2,
    name: 'Production Team 2',
    leaderId: 17,
    members: [member(19, 'VIDEO EDITOR'), member(18, 'GRAPHIC DESIGNER'), member(20, 'SENIOR PHOTOGRAPHER')],
  };
  const TEAM_PEOPLE = [19, 18, 20, 17];

  const subscription = (customer: any) => ({
    id: 202,
    customerId: customer.id,
    planId: 2,
    status: SubscriptionStatus.ACTIVE,
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    endDate: new Date('2026-10-01T00:00:00.000Z'),
    createdAt: new Date('2026-08-30T10:00:00.000Z'),
    customFeatures: null,
    plan: { id: 2, name: 'Monthly Standard Package', code: 'STANDARD', features: ['4 Reels', '3 Creative Posts', '3 Stories'] },
    customer,
  });

  beforeEach(async () => {
    prisma = {
      customerSubscription: { findUnique: jest.fn(), findFirst: jest.fn() },
      planEntitlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 900 + Math.floor(Math.random() * 1000), ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 900, ...data })),
      },
      work: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: Math.floor(Math.random() * 1e6), ...data })),
      },
      workTask: {
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      team: { findUnique: jest.fn().mockResolvedValue(TEAM) },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        { provide: WorkPermissionService, useValue: { getAllowedActivityTypesForEmployee: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(WorkService);
  });

  const createdWorks = () => prisma.work.create.mock.calls.map(([args]: any) => args.data);
  const createdTaskRows = () => prisma.workTask.createMany.mock.calls.flatMap(([args]: any) => args.data);

  describe('generatePlanSchedules (plan purchased)', () => {
    it('gives the work and its tasks to production team members, not to the sales owner', async () => {
      const customer = { id: 127, leadId: 55, assignedEmployeeId: 2, assignedTeamId: 2, assignedEmployeeRel: SALES_OWNER };
      prisma.customerSubscription.findUnique.mockResolvedValue(subscription(customer));

      const result = await service.generatePlanSchedules(127, 202);

      expect(result.success).toBe(true);
      const works = createdWorks();
      expect(works.length).toBeGreaterThan(0);
      for (const w of works) {
        expect(w.teamId).toBe(2);
        expect(TEAM_PEOPLE).toContain(w.assignedToId);
        expect(w.assignedToId).not.toBe(2);
        expect(w.status).toBe(WorkStatus.ASSIGNED);
      }
      const tasks = createdTaskRows();
      expect(tasks.length).toBe(works.length * 3);
      for (const t of tasks) expect(TEAM_PEOPLE).toContain(t.assignedToId);
    });

    it('spreads the work over the members that fit each activity', async () => {
      const customer = { id: 127, leadId: 55, assignedEmployeeId: 2, assignedTeamId: 2, assignedEmployeeRel: SALES_OWNER };
      prisma.customerSubscription.findUnique.mockResolvedValue(subscription(customer));

      await service.generatePlanSchedules(127, 202);

      const assignees = new Set(createdWorks().map((w: any) => w.assignedToId));
      expect(assignees.size).toBeGreaterThan(1);
    });

    it('leaves the work unassigned (and visible to the owner) while the customer has no team', async () => {
      const customer = { id: 129, leadId: 56, assignedEmployeeId: 2, assignedTeamId: null, assignedEmployeeRel: SALES_OWNER };
      prisma.customerSubscription.findUnique.mockResolvedValue(subscription(customer));

      await service.generatePlanSchedules(129, 202);

      for (const w of createdWorks()) {
        expect(w.assignedToId).toBeNull();
        expect(w.teamId).toBeNull();
        expect(w.status).toBe(WorkStatus.SCHEDULED);
      }
      for (const t of createdTaskRows()) expect(t.assignedToId).toBeNull();
    });

    it('still uses a production employee who is set as the customer\'s own employee', async () => {
      const customer = { id: 140, leadId: null, assignedEmployeeId: 30, assignedTeamId: 2, assignedEmployeeRel: PRODUCTION_OWNER };
      prisma.customerSubscription.findUnique.mockResolvedValue(subscription(customer));

      await service.generatePlanSchedules(140, 202);

      for (const w of createdWorks()) expect(w.assignedToId).toBe(30);
    });

    it('behaves as before for a customer who signed up in the app (no employee, team set)', async () => {
      const customer = { id: 128, leadId: null, assignedEmployeeId: null, assignedTeamId: 2, assignedEmployeeRel: null };
      prisma.customerSubscription.findUnique.mockResolvedValue(subscription(customer));

      await service.generatePlanSchedules(128, 202);

      for (const w of createdWorks()) expect(TEAM_PEOPLE).toContain(w.assignedToId);
    });
  });

  describe('syncCustomerTeamWorkAssignments (team set / re-saved on the customer)', () => {
    const work = (id: number, over: any = {}) => ({
      id,
      customerId: 127,
      workType: 'REEL_EDIT',
      title: `Reel #${id}: Edit`,
      description: '',
      status: WorkStatus.ASSIGNED,
      teamId: 2,
      assignedToId: 2,
      assignedTo: SALES_OWNER,
      ...over,
    });
    const workUpdates = () => prisma.work.update.mock.calls.map(([args]: any) => ({ id: args.where.id, ...args.data }));

    it('asks for works held by someone outside the team, not only unassigned ones', async () => {
      prisma.work.findMany.mockResolvedValue([]);

      await service.syncCustomerTeamWorkAssignments(127, 2);

      const { where } = prisma.work.findMany.mock.calls[0][0];
      expect(where.OR).toEqual(expect.arrayContaining([{ assignedToId: { notIn: expect.arrayContaining(TEAM_PEOPLE) } }]));
    });

    it('moves work and still-pending tasks from the sales owner to team members', async () => {
      prisma.work.findMany.mockResolvedValue([work(1), work(2, { status: WorkStatus.SCHEDULED })]);

      const updated = await service.syncCustomerTeamWorkAssignments(127, 2);

      expect(updated).toBe(2);
      for (const u of workUpdates()) {
        expect(TEAM_PEOPLE).toContain(u.assignedToId);
        expect(u.teamId).toBe(2);
        expect(u.status).toBe(WorkStatus.ASSIGNED);
      }
      const moveCalls = prisma.workTask.updateMany.mock.calls
        .map(([args]: any) => args)
        .filter((a: any) => a.where.assignedToId === 2);
      expect(moveCalls).toHaveLength(2);
      for (const c of moveCalls) {
        expect(c.where.status).toBe(TaskStatus.PENDING);
        expect(TEAM_PEOPLE).toContain(c.data.assignedToId);
      }
    });

    it('does not take over work the sales owner already started or finished', async () => {
      prisma.work.findMany.mockResolvedValue([
        work(3, { status: WorkStatus.IN_PROGRESS }),
        work(4, { status: WorkStatus.COMPLETED }),
      ]);

      await service.syncCustomerTeamWorkAssignments(127, 2);

      expect(workUpdates()).toEqual([]);
      expect(prisma.workTask.updateMany).not.toHaveBeenCalled();
    });

    it('does not move a production employee who was assigned by hand outside the team', async () => {
      prisma.work.findMany.mockResolvedValue([work(5, { assignedToId: 30, assignedTo: PRODUCTION_OWNER })]);

      await service.syncCustomerTeamWorkAssignments(127, 2);

      expect(workUpdates()).toEqual([]);
    });

    it('keeps the sales owner when the team has nobody to give the work to', async () => {
      prisma.team.findUnique.mockResolvedValue({ ...TEAM, leaderId: null, members: [] });
      prisma.work.findMany.mockResolvedValue([work(6)]);

      await service.syncCustomerTeamWorkAssignments(127, 2);

      expect(workUpdates()).toEqual([]);
    });

    it('still hands out unassigned works (original behaviour)', async () => {
      prisma.work.findMany.mockResolvedValue([work(7, { assignedToId: null, assignedTo: null, teamId: null, status: WorkStatus.SCHEDULED })]);

      await service.syncCustomerTeamWorkAssignments(128, 2);

      const [u] = workUpdates();
      expect(TEAM_PEOPLE).toContain(u.assignedToId);
      expect(u.teamId).toBe(2);
      expect(u.status).toBe(WorkStatus.ASSIGNED);
    });
  });
});
