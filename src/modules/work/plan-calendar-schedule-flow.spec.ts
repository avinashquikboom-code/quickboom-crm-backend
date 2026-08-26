import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { WorkStatus, WorkType, TaskStatus, SubscriptionStatus } from '@prisma/client';
import { calculatePlanBillingPeriod, calculatePlanExpiry } from '../../common/utils/subscription-date.util';

describe('Customer Plan -> Purchase -> Calendar Scheduling Flow Tests', () => {
  let workService: WorkService;
  let prisma: any;
  let planAccessService: any;

  beforeEach(async () => {
    prisma = {
      work: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        count: jest.fn(),
      },
      workTask: {
        createMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      planEntitlement: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customerSubscription: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prisma);
        }
        return Promise.all(cb);
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

    workService = module.get<WorkService>(WorkService);
  });

  describe('1. Date Arithmetic & Billing Period Calculations', () => {
    it('calculates monthly billing period accurately (20 Aug 2026 -> 20 Sep 2026)', () => {
      const start = new Date('2026-08-20T00:00:00.000Z');
      const billing = calculatePlanBillingPeriod(start, 1);

      expect(billing.startDate.toISOString()).toContain('2026-08-20');
      expect(billing.endDate.toISOString()).toContain('2026-09-20');
    });

    it('handles month-end clamping (31 Jan -> 28 Feb)', () => {
      const start = new Date('2026-01-31T00:00:00.000Z');
      const expiry = calculatePlanExpiry(start, 1);

      expect(expiry.getMonth()).toBe(1); // February (0-indexed 1)
      expect(expiry.getDate()).toBe(28); // 2026 is non-leap year
    });

    it('calculates 15 Jan -> 15 Feb', () => {
      const start = new Date('2026-01-15T00:00:00.000Z');
      const expiry = calculatePlanExpiry(start, 1);
      expect(expiry.getMonth()).toBe(1);
      expect(expiry.getDate()).toBe(15);
    });
  });

  describe('2. Basic Package (11 Deliverables) Multi-Stage Schedule Generation', () => {
    it('generates multi-stage Reel workflows (Shoot, Edit, Upload) & deliverables for Basic Package', async () => {
      const customerId = 101;
      const startDate = new Date('2026-08-20T00:00:00.000Z');
      const endDate = new Date('2026-09-20T00:00:00.000Z');

      planAccessService.getEffectivePlan.mockResolvedValue({
        planId: 1,
        planName: 'Basic Package',
        planCode: 'BASIC',
        isActive: true,
        isExpired: false,
        startDate,
        endDate,
      });

      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 501,
        customerId,
        planId: 1,
        status: SubscriptionStatus.ACTIVE,
        startDate,
        endDate,
      });

      // Basic entitlements: 4 Reels, 3 Creative Posts, 1 Influencer Promo, 3 Stories (Total = 11)
      prisma.planEntitlement.findMany.mockResolvedValue([
        { id: 1, serviceName: 'Reels', totalQty: 4, usedQty: 0, scheduledQty: 0 },
        { id: 2, serviceName: 'Creative Posts', totalQty: 3, usedQty: 0, scheduledQty: 0 },
        { id: 3, serviceName: 'Influencer Promotion', totalQty: 1, usedQty: 0, scheduledQty: 0 },
        { id: 4, serviceName: 'Stories', totalQty: 3, usedQty: 0, scheduledQty: 0 },
      ]);

      // No existing works yet
      prisma.work.findMany.mockResolvedValue([]);
      prisma.work.create.mockImplementation((args: any) => ({ id: Math.floor(Math.random() * 1000) + 1, ...args.data }));
      prisma.work.count.mockResolvedValue(1);
      prisma.planEntitlement.update.mockResolvedValue({});

      const result = await workService.generatePlanSchedules(customerId);

      expect(result.success).toBe(true);
      // 4 Reels * 3 stages (Shoot, Edit, Upload) = 12 + 3 Posts + 1 Influencer + 3 Stories = 19 scheduled stages
      expect(result.createdCount).toBe(19);

      // Verify Reel tasks were created with Shoot -> Edit -> Upload
      expect(prisma.workTask.createMany).toHaveBeenCalled();
      const taskCalls = prisma.workTask.createMany.mock.calls;
      expect(taskCalls.some((c: any) => c[0].data[0].title.includes('Reel Shoot') || c[0].data[0].title.includes('Rough Cut') || c[0].data[0].title.includes('Script'))).toBe(true);
    });
  });

  describe('3. Schedule Generation Idempotency & Duplicate Prevention', () => {
    it('does not create duplicate work records if schedules already exist for entitlement', async () => {
      const customerId = 101;
      const startDate = new Date('2026-08-20T00:00:00.000Z');
      const endDate = new Date('2026-09-20T00:00:00.000Z');

      planAccessService.getEffectivePlan.mockResolvedValue({
        planId: 1,
        planName: 'Basic Package',
        planCode: 'BASIC',
        isActive: true,
        isExpired: false,
        startDate,
        endDate,
      });

      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 501,
        customerId,
        planId: 1,
        status: SubscriptionStatus.ACTIVE,
        startDate,
        endDate,
      });

      prisma.planEntitlement.findMany.mockResolvedValue([
        { id: 1, serviceName: 'Reels', totalQty: 4, usedQty: 0, scheduledQty: 4 },
      ]);

      // Simulate 4 works already existing
      prisma.work.findMany.mockResolvedValue([
        { id: 1, entitlementId: 1, title: 'Reels #1 - Shoot' },
        { id: 2, entitlementId: 1, title: 'Reels #2 - Shoot' },
        { id: 3, entitlementId: 1, title: 'Reels #3 - Shoot' },
        { id: 4, entitlementId: 1, title: 'Reels #4 - Shoot' },
      ]);

      const result = await workService.generatePlanSchedules(customerId);

      expect(result.success).toBe(true);
      expect(result.createdCount).toBe(0);
      expect(prisma.work.create).not.toHaveBeenCalled();
    });

    it('returns unsuccessful result if plan is inactive or expired', async () => {
      const customerId = 102;
      planAccessService.getEffectivePlan.mockResolvedValue({
        planId: 1,
        isActive: false,
        isExpired: true,
      });

      const result = await workService.generatePlanSchedules(customerId);
      expect(result.success).toBe(false);
      expect(result.createdCount).toBe(0);
    });
  });

  describe('4. Single-Date Calendar Querying', () => {
    it('returns only activities matching requested single date', async () => {
      const customerId = 101;
      const targetDateStr = '2026-08-20';

      prisma.work.findMany.mockResolvedValue([
        {
          id: 10,
          customerId,
          subscriptionId: 501,
          workType: WorkType.REELS_SHOOT,
          title: 'Reels #1 - Shoot',
          scheduledDate: new Date('2026-08-20T11:00:00.000Z'),
          scheduledTime: '11:00 AM',
          status: WorkStatus.SCHEDULED,
          customer: { id: 101, name: 'Aarav Fashion' },
          team: { name: 'SSM Production Team' },
          assignedTo: { id: 1, firstName: 'Priya', lastName: 'Sharma' },
          editor: null,
          entitlement: { serviceName: 'Reels' },
          subscription: { id: 501, plan: { name: 'Basic Package' } },
        },
      ]);

      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 501,
        startDate: new Date('2026-08-20T00:00:00.000Z'),
        plan: { name: 'Basic Package' },
        customer: { name: 'Aarav Fashion' },
      });

      const calendar = await workService.getCalendar(customerId, { date: targetDateStr });

      expect(Array.isArray(calendar)).toBe(true);
      expect(calendar.length).toBeGreaterThanOrEqual(1);
      expect(calendar.some((item) => item.title.includes('Reels #1 - Shoot'))).toBe(true);
      expect(calendar.every((item) => item.customerId === '101')).toBe(true);
    });
  });
});
