import { Test, TestingModule } from '@nestjs/testing';
import { WorkService } from './work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkStatus, WorkType, SubscriptionStatus, PaymentMethod, InvoiceStatus } from '@prisma/client';
import { calculatePlanBillingPeriod, calculatePlanExpiry } from '../../common/utils/subscription-date.util';
import { extractReelCount, generateReelWorkflowActivities } from '../../common/utils/plan-deliverable.util';

describe('Plan-Based Content Calendar & Advance Payment/Billing Tests', () => {
  let workService: WorkService;
  let prisma: any;

  const mockPlanSub = (customerId: number, reelFeatures: any, startDate: Date, endDate: Date) => ({
    id: 501,
    customerId,
    planId: 1,
    status: SubscriptionStatus.ACTIVE,
    startDate,
    endDate,
    customUserLimit: null,
    customLeadLimit: null,
    customStorageLimit: null,
    customFeatures: null,
    customPrice: null,
    billingCycle: 'MONTHLY',
    deletedAt: null,
    plan: {
      id: 1,
      name: 'Custom Reels Plan',
      code: 'REELS_PLAN',
      monthlyPrice: 10000,
      yearlyPrice: 100000,
      features: reelFeatures,
    },
  });

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
        findUnique: jest.fn(),
      },
      paymentHistory: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      invoice: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      notification: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prisma);
        }
        return Promise.all(cb);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    workService = module.get<WorkService>(WorkService);
  });

  describe('1. Dynamic Reel Quota & Activity Calculation', () => {
    it('correctly extracts reel count from various formats (string array, object, key-value)', () => {
      expect(extractReelCount(['4 Reels', '3 Creative Posts'])).toBe(4);
      expect(extractReelCount(['1 Reel', '2 Stories'])).toBe(1);
      expect(extractReelCount(['8 Influencer Reels'])).toBe(8);
      expect(extractReelCount({ reels: 12 })).toBe(12);
      expect(extractReelCount([{ name: 'Reels', quantity: 4 }])).toBe(4);
      expect(extractReelCount(['Custom Strategy (Total 10 Reels)'])).toBe(10);
    });

    it('generates exact 3 activities per Reel with Shoot (+0d), Editing (+2d), Post (+4d) across weekly intervals', () => {
      const start = new Date('2026-08-20T00:00:00.000Z');
      const end = new Date('2026-09-20T00:00:00.000Z');

      // Test 1: 1 Reel Plan -> 3 activities
      const oneReelActs = generateReelWorkflowActivities(start, end, 1);
      expect(oneReelActs).toHaveLength(3);
      expect(oneReelActs[0].title).toBe('Reel #1: Shoot');
      expect(oneReelActs[0].scheduledDate.toISOString()).toContain('2026-08-20');
      expect(oneReelActs[1].title).toBe('Reel #1: Editing');
      expect(oneReelActs[1].scheduledDate.toISOString()).toContain('2026-08-22');
      expect(oneReelActs[2].title).toBe('Reel #1: Post');
      expect(oneReelActs[2].scheduledDate.toISOString()).toContain('2026-08-24');

      // Test 2: 4 Reels Plan -> 12 activities
      const fourReelActs = generateReelWorkflowActivities(start, end, 4);
      expect(fourReelActs).toHaveLength(12);
      // Week 1 (Reel 1)
      expect(fourReelActs[0].scheduledDate.toISOString()).toContain('2026-08-20'); // Shoot
      expect(fourReelActs[1].scheduledDate.toISOString()).toContain('2026-08-22'); // Editing
      expect(fourReelActs[2].scheduledDate.toISOString()).toContain('2026-08-24'); // Post
      // Week 2 (Reel 2)
      expect(fourReelActs[3].scheduledDate.toISOString()).toContain('2026-08-27'); // Shoot
      expect(fourReelActs[4].scheduledDate.toISOString()).toContain('2026-08-29'); // Editing
      expect(fourReelActs[5].scheduledDate.toISOString()).toContain('2026-08-31'); // Post
      // Week 3 (Reel 3)
      expect(fourReelActs[6].scheduledDate.toISOString()).toContain('2026-09-03'); // Shoot
      expect(fourReelActs[7].scheduledDate.toISOString()).toContain('2026-09-05'); // Editing
      expect(fourReelActs[8].scheduledDate.toISOString()).toContain('2026-09-07'); // Post
      // Week 4 (Reel 4)
      expect(fourReelActs[9].scheduledDate.toISOString()).toContain('2026-09-10'); // Shoot
      expect(fourReelActs[10].scheduledDate.toISOString()).toContain('2026-09-12'); // Editing
      expect(fourReelActs[11].scheduledDate.toISOString()).toContain('2026-09-14'); // Post

      // Test 3: 8 Reels Plan -> 24 activities (when within date limit)
      const eightEnd = new Date('2026-10-30T00:00:00.000Z');
      const eightReelActs = generateReelWorkflowActivities(start, eightEnd, 8);
      expect(eightReelActs).toHaveLength(24);
    });
  });

  describe('2. Schedule Generation & Idempotency in WorkService', () => {
    it('generates exactly 12 Reel workflow activities for 4 Reels plan', async () => {
      const customerId = 101;
      const start = new Date('2026-08-20T00:00:00.000Z');
      const end = new Date('2026-09-20T00:00:00.000Z');

      prisma.customerSubscription.findFirst.mockResolvedValue(
        mockPlanSub(customerId, ['4 Reels'], start, end),
      );

      prisma.planEntitlement.findFirst.mockResolvedValue(null);
      prisma.planEntitlement.create.mockImplementation((args: any) => ({ id: 1, ...args.data }));
      prisma.planEntitlement.update.mockResolvedValue({});

      prisma.work.findMany.mockResolvedValue([]);
      prisma.work.create.mockImplementation((args: any) => ({ id: Math.floor(Math.random() * 1000) + 1, ...args.data }));
      prisma.work.count.mockResolvedValue(12);

      const result = await workService.generatePlanSchedules(customerId);

      expect(result.success).toBe(true);
      expect(result.createdCount).toBe(12);
      expect(prisma.work.create).toHaveBeenCalledTimes(12);
      expect(prisma.workTask.createMany).toHaveBeenCalledTimes(12);
    });

    it('is fully idempotent: subsequent calls create 0 duplicates', async () => {
      const customerId = 101;
      const start = new Date('2026-08-20T00:00:00.000Z');
      const end = new Date('2026-09-20T00:00:00.000Z');

      prisma.customerSubscription.findFirst.mockResolvedValue(
        mockPlanSub(customerId, ['4 Reels'], start, end),
      );

      prisma.planEntitlement.findFirst.mockResolvedValue({ id: 1, serviceName: 'Reels', totalQty: 4, scheduledQty: 4 });
      prisma.planEntitlement.update.mockResolvedValue({});

      // Mock 12 already existing works
      const existingWorks = Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        title: `Reel #${Math.floor(i / 3) + 1}: ${['Shoot', 'Editing', 'Post'][i % 3]}`,
        customerId,
        subscriptionId: 501,
      }));

      prisma.work.findMany.mockResolvedValue(existingWorks);
      prisma.work.count.mockResolvedValue(12);

      const result = await workService.generatePlanSchedules(customerId);

      expect(result.success).toBe(true);
      expect(result.createdCount).toBe(0);
      expect(prisma.work.create).not.toHaveBeenCalled();
    });
  });

  describe('3. Calendar Filtering & Isolation', () => {
    it('returns only database items matching target date with zero synthetic pseudo-events', async () => {
      const customerId = 101;
      const targetDate = '2026-08-20';

      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 501,
        customerId,
        status: SubscriptionStatus.ACTIVE,
        plan: { name: 'Custom Reels Plan' },
      });

      prisma.work.count.mockResolvedValue(12);

      prisma.work.findMany.mockResolvedValue([
        {
          id: 101,
          customerId,
          subscriptionId: 501,
          workType: WorkType.SHOOT,
          title: 'Reel #1: Shoot',
          scheduledDate: new Date('2026-08-20T10:00:00.000Z'),
          scheduledTime: '10:00 AM',
          status: WorkStatus.SCHEDULED,
          customer: { id: 101, name: 'Client A' },
          team: { name: 'Video Team' },
          assignedTo: { id: 5, firstName: 'Rohit', lastName: 'Verma' },
          editor: null,
          entitlement: { serviceName: 'Reels' },
          subscription: { id: 501, plan: { name: 'Custom Reels Plan' } },
        },
      ]);

      const calendar = await workService.getCalendar(customerId, { date: targetDate });

      expect(calendar).toHaveLength(1);
      expect(calendar[0].title).toBe('Reel #1: Shoot');
      expect(calendar.some((c: any) => c.id.toString().includes('sub-start'))).toBe(false);
    });
  });
});
