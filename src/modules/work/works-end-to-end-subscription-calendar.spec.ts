import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { WorkStatus, SubscriptionStatus, SubscriptionBillingCycle, WorkType } from '@prisma/client';

describe('Works End-to-End Subscription & Calendar Flow Tests', () => {
  let service: WorkService;
  let prisma: any;
  let planAccessService: any;

  beforeEach(async () => {
    prisma = {
      plan: {
        findUnique: jest.fn(),
      },
      customerSubscription: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          id: 201,
          customerId: 11,
          status: SubscriptionStatus.ACTIVE,
          plan: { name: 'Growth Plan' },
        }),
      },
      work: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      workTask: {
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      planEntitlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 1, ...args.data })),
        update: jest.fn(),
      },
      attendancePolicy: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 11, name: 'Care Fitness Gym' }),
      },
      subscriptionInstallment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      notification: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      paymentHistory: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (callback) => {
        if (typeof callback === 'function') {
          return callback(prisma);
        }
        return Promise.all(callback);
      }),
    };

    planAccessService = {
      getEffectivePlan: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlanAccessService, useValue: planAccessService },
      ],
    }).compile();

    service = module.get<WorkService>(WorkService);
  });

  it('STEP 1: Customer purchases plan -> Auto-creates subscription and activity schedules', async () => {
    const planMock = {
      id: 1,
      name: 'Growth Plan',
      code: 'GROWTH',
      features: ['4 Reels', '4 Stories'],
    };

    const createdSubMock = {
      id: 101,
      customerId: 11,
      planId: 1,
      status: SubscriptionStatus.ACTIVE,
      billingCycle: SubscriptionBillingCycle.MONTHLY,
      startDate: new Date('2026-08-20T00:00:00.000Z'),
      endDate: new Date('2026-09-20T00:00:00.000Z'),
      plan: planMock,
    };

    prisma.plan.findUnique.mockResolvedValue(planMock);
    prisma.customerSubscription.create.mockResolvedValue(createdSubMock);
    prisma.customerSubscription.findUnique.mockResolvedValue(createdSubMock);

    prisma.work.create.mockImplementation((args: any) => {
      return Promise.resolve({
        id: Math.floor(Math.random() * 1000) + 1,
        ...args.data,
        status: WorkStatus.SCHEDULED,
        tasks: [],
      });
    });

    const result = await service.purchaseSubscription(11, 1);

    expect(result.success).toBe(true);
    expect(result.subscriptionId).toBe(101);
    expect(result.schedulesCreated).toBeGreaterThan(0);
    expect(prisma.customerSubscription.create).toHaveBeenCalled();
    expect(prisma.work.create).toHaveBeenCalled();
  });

  it('STEP 2: Get calendar for date -> Returns matching activities', async () => {
    const mockWorks = [
      {
        id: 54,
        customerId: 11,
        title: 'Reel #1: Shoot',
        workType: WorkType.REELS_SHOOT,
        scheduledDate: new Date('2026-08-29T10:00:00.000Z'),
        scheduledTime: '10:00 AM',
        status: WorkStatus.SCHEDULED,
        notes: 'Reel Shoot',
        tasks: [],
      },
    ];

    prisma.work.findMany.mockResolvedValue(mockWorks);

    const activities = await service.getCalendar(11, { date: '2026-08-29' });

    expect(Array.isArray(activities)).toBe(true);
    expect(activities.length).toBe(1);
    expect(activities[0].title).toBe('Reel #1: Shoot');
    expect(activities[0].scheduledDate).toBe('2026-08-29');
    expect(activities[0].time).toBe('10:00 AM');
  });

  it('STEP 3: Customer marks activity completed -> Updates status and completedAt', async () => {
    const existingWork = {
      id: 54,
      customerId: 11,
      title: 'Reel #1: Shoot',
      status: WorkStatus.SCHEDULED,
    };

    const completedWork = {
      id: 54,
      customerId: 11,
      title: 'Reel #1: Shoot',
      status: WorkStatus.COMPLETED,
      completedAt: new Date('2026-08-29T11:00:00.000Z'),
    };

    prisma.work.findFirst.mockResolvedValue(existingWork);
    prisma.work.update.mockResolvedValue(completedWork);

    const result = await service.completeActivity(54, 11);

    expect(result.success).toBe(true);
    expect(result.activity.status).toBe('completed');
    expect(result.activity.completedAt).toBeDefined();
    expect(prisma.work.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 54 },
        data: expect.objectContaining({
          status: WorkStatus.COMPLETED,
        }),
      }),
    );
  });

  it('STEP 4: Skip activity -> Updates status to CANCELLED', async () => {
    const cancelledWork = {
      id: 55,
      customerId: 11,
      title: 'Reel #1: Edit',
      status: WorkStatus.CANCELLED,
    };

    prisma.work.update.mockResolvedValue(cancelledWork);

    const result = await service.skipActivity(55);

    expect(result.success).toBe(true);
    expect(result.activity.status).toBe(WorkStatus.CANCELLED);
  });

  it('STEP 5: Get month calendar -> Returns grouped calendar map', async () => {
    const mockWorks = [
      {
        id: 54,
        customerId: 11,
        title: 'Reel #1: Shoot',
        workType: WorkType.REELS_SHOOT,
        scheduledDate: new Date('2026-08-29T10:00:00.000Z'),
        scheduledTime: '10:00 AM',
        status: WorkStatus.SCHEDULED,
        notes: 'Reel Shoot',
        tasks: [],
      },
    ];

    prisma.work.findMany.mockResolvedValue(mockWorks);

    const monthResult = await service.getMonthCalendar(11, 2026, 8);

    expect(monthResult.year).toBe(2026);
    expect(monthResult.month).toBe(8);
    expect(monthResult.calendar['2026-08-29']).toBeDefined();
    expect(monthResult.calendar['2026-08-29'].length).toBe(1);
    expect(monthResult.calendar['2026-08-29'][0].activity).toBe('Reel #1: Shoot');
  });

  it('STEP 6: Plan Purchase 30 Aug 2026 -> Start 01 Sep 2026, End 01 Oct 2026, strict date boundaries', async () => {
    const planMock = {
      id: 2,
      name: 'Monthly Standard Package',
      code: 'STANDARD',
      features: ['4 Reels', '3 Creative Posts', '3 Stories'],
    };

    const purchaseDate = new Date('2026-08-30T10:00:00.000Z');
    // Start is 2 calendar days after purchase
    const startDate = new Date('2026-09-01T00:00:00.000Z');
    const endDate = new Date('2026-10-01T00:00:00.000Z');

    const createdSubMock = {
      id: 202,
      customerId: 11,
      planId: 2,
      status: SubscriptionStatus.ACTIVE,
      billingCycle: SubscriptionBillingCycle.MONTHLY,
      startDate,
      endDate,
      createdAt: purchaseDate,
      plan: planMock,
    };

    prisma.plan.findUnique.mockResolvedValue(planMock);
    prisma.customerSubscription.findUnique.mockResolvedValue(createdSubMock);

    const createdWorkItems: any[] = [];
    prisma.work.create.mockImplementation((args: any) => {
      const item = {
        id: createdWorkItems.length + 1,
        ...args.data,
        status: WorkStatus.SCHEDULED,
      };
      createdWorkItems.push(item);
      return Promise.resolve(item);
    });

    const result = await service.generatePlanSchedules(11, 202);

    expect(result.success).toBe(true);
    expect(result.createdCount).toBeGreaterThan(0);
    expect(createdWorkItems.length).toBeGreaterThan(0);

    // Verify all activities fall strictly within 01 Sep 2026 <= activityDate < 01 Oct 2026
    for (const work of createdWorkItems) {
      const actDate = new Date(work.scheduledDate);
      expect(actDate.getTime()).toBeGreaterThanOrEqual(startDate.getTime());
      expect(actDate.getTime()).toBeLessThan(endDate.getTime());

      const dateStr = actDate.toISOString().split('T')[0];
      // Must NOT be 30 Aug or 31 Aug
      expect(dateStr).not.toBe('2026-08-30');
      expect(dateStr).not.toBe('2026-08-31');
      // Must NOT be 01 Oct
      expect(dateStr).not.toBe('2026-10-01');
    }

    // First activity date must be on 2026-09-01
    const firstDateStr = new Date(createdWorkItems[0].scheduledDate).toISOString().split('T')[0];
    expect(firstDateStr).toBe('2026-09-01');
  });
});
