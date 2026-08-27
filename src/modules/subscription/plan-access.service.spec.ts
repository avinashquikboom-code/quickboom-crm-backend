import { Test, TestingModule } from '@nestjs/testing';
import { PlanAccessService } from './plan-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';

(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

describe('PlanAccessService — Centralized Plan & Limit Enforcement', () => {
  let service: PlanAccessService;
  let prisma: any;

  const mockBasePremiumPlan = {
    id: 1,
    name: 'Premium Package',
    code: 'PREMIUM',
    monthlyPrice: 25999,
    yearlyPrice: 249590,
    userLimit: 100,
    leadLimit: 50000,
    storageLimit: BigInt(107374182400), // 100 GB
    features: ['Customer Management', 'Calendar', 'Schedule', 'Works', 'Advanced Reports'],
    isActive: true,
  };

  const mockBaseBasicPlan = {
    id: 2,
    name: 'Basic Package',
    code: 'BASIC',
    monthlyPrice: 9999,
    yearlyPrice: 95990,
    userLimit: 5,
    leadLimit: 500,
    storageLimit: BigInt(5368709120), // 5 GB
    features: ['Customer Management', 'Calendar', 'Works'],
    isActive: true,
  };

  beforeEach(async () => {
    const subFindFirst = jest.fn();
    prisma = {
      customerSubscription: {
        findFirst: subFindFirst,
        findMany: jest.fn(async (args) => {
          const res = await subFindFirst(args);
          return res ? [res] : [];
        }),
      },
      plan: {
        findFirst: jest.fn(),
      },
      employee: {
        count: jest.fn(),
      },
      lead: {
        count: jest.fn(),
      },
      work: {
        count: jest.fn(),
      },
      planEntitlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanAccessService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PlanAccessService>(PlanAccessService);
  });

  describe('1. Customer A: Customized Plan Resolution & Limit Priority', () => {
    it('uses custom userLimit (10), custom leadLimit (1000), custom storage (20GB), custom price (19999) over base Premium plan', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 101,
        customerId: 1,
        planId: 1,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'MONTHLY',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        customUserLimit: 10,
        customLeadLimit: 1000,
        customStorageLimit: BigInt(21474836480), // 20 GB
        customPrice: 19999,
        customFeatures: ['Customer Management', 'Calendar', 'Custom Schedule Access'],
        plan: mockBasePremiumPlan,
      });

      prisma.employee.count.mockResolvedValue(5);
      prisma.lead.count.mockResolvedValue(500);
      prisma.work.count.mockResolvedValue(2);

      const effective = await service.getEffectivePlan(1);

      expect(effective.isCustomized).toBe(true);
      expect(effective.userLimit).toBe(10);
      expect(effective.leadLimit).toBe(1000);
      expect(effective.price).toBe(19999);
      expect(effective.basePrice).toBe(25999);
      expect(Number(effective.storageLimitBytes)).toBe(21474836480);
      expect(effective.features).toContain('Custom Schedule Access');
    });

    it('Customer A user limit: 10 users allowed, 11th user rejected', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 101,
        customerId: 1,
        planId: 1,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'MONTHLY',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        customUserLimit: 10,
        plan: mockBasePremiumPlan,
      });

      // Current users = 9 (under limit)
      prisma.employee.count.mockResolvedValue(9);
      await expect(service.checkUserLimit(1)).resolves.toBeDefined();

      // Current users = 10 (at limit -> 11th rejected)
      prisma.employee.count.mockResolvedValue(10);
      await expect(service.checkUserLimit(1)).rejects.toThrow(BadRequestException);
    });

    it('Customer A lead limit: 1000 leads allowed, 1001st lead rejected', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 101,
        customerId: 1,
        planId: 1,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'MONTHLY',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        customLeadLimit: 1000,
        plan: mockBasePremiumPlan,
      });

      // 999 leads (under limit)
      prisma.lead.count.mockResolvedValue(999);
      await expect(service.checkLeadLimit(1)).resolves.toBeDefined();

      // 1000 leads (at limit -> rejected)
      prisma.lead.count.mockResolvedValue(1000);
      await expect(service.checkLeadLimit(1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('2. Customer B: Standard Base Plan Fallback & Cross-Tenant Isolation', () => {
    it('Customer B uses base Premium limits (100 users, 50000 leads) when custom fields are null', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 102,
        customerId: 2,
        planId: 1,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'MONTHLY',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        customUserLimit: null,
        customLeadLimit: null,
        customStorageLimit: null,
        customPrice: null,
        customFeatures: null,
        plan: mockBasePremiumPlan,
      });

      prisma.employee.count.mockResolvedValue(15);
      prisma.lead.count.mockResolvedValue(2000);
      prisma.work.count.mockResolvedValue(5);

      const effective = await service.getEffectivePlan(2);

      expect(effective.isCustomized).toBe(false);
      expect(effective.userLimit).toBe(100);
      expect(effective.leadLimit).toBe(50000);
      expect(effective.price).toBe(25999);
      expect(effective.customPrice).toBeNull();
    });

    it('Customer A custom override does NOT affect Customer B', async () => {
      // Customer B with 15 users is allowed (under base 100 limit, even though Customer A custom limit is 10)
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 102,
        customerId: 2,
        planId: 1,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'MONTHLY',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        customUserLimit: null,
        plan: mockBasePremiumPlan,
      });

      prisma.employee.count.mockResolvedValue(15);
      await expect(service.checkUserLimit(2)).resolves.toBeDefined();
    });
  });

  describe('3. Customer C: Basic Package Limits', () => {
    it('enforces Basic plan limits (5 users, 500 leads)', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 103,
        customerId: 3,
        planId: 2,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'MONTHLY',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        plan: mockBaseBasicPlan,
      });

      // 4 users -> OK
      prisma.employee.count.mockResolvedValue(4);
      await expect(service.checkUserLimit(3)).resolves.toBeDefined();

      // 5 users -> 6th rejected
      prisma.employee.count.mockResolvedValue(5);
      await expect(service.checkUserLimit(3)).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. Subscription Expiry & Inactivity Handling', () => {
    it('blocks plan operations when subscription status is EXPIRED', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 104,
        customerId: 4,
        planId: 1,
        status: SubscriptionStatus.EXPIRED,
        billingCycle: 'MONTHLY',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
        plan: mockBasePremiumPlan,
      });

      await expect(service.checkSubscriptionActive(4)).rejects.toThrow(ForbiddenException);
      await expect(service.checkUserLimit(4)).rejects.toThrow(ForbiddenException);
      await expect(service.checkLeadLimit(4)).rejects.toThrow(ForbiddenException);
    });

    it('blocks plan operations when endDate is in the past', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 105,
        customerId: 5,
        planId: 1,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'MONTHLY',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-06-01'), // Past date
        plan: mockBasePremiumPlan,
      });

      await expect(service.checkSubscriptionActive(5)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('5. Feature Access Enforcement', () => {
    it('allows feature when present in effective features', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 101,
        customerId: 1,
        planId: 1,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'MONTHLY',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        plan: mockBasePremiumPlan,
      });

      await expect(service.checkFeatureAccess(1, 'Advanced Reports')).resolves.toBeDefined();
    });

    it('rejects feature when disabled / missing in plan', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 103,
        customerId: 3,
        planId: 2,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'MONTHLY',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        plan: mockBaseBasicPlan, // Basic lacks Advanced Analytics
      });

      await expect(service.checkFeatureAccess(3, 'Enterprise AI Copilot')).rejects.toThrow(ForbiddenException);
    });
  });
});
