import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { PaymentService } from '../payment/payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanAccessService } from './plan-access.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import { NotificationService } from '../notification/notification.service';
import { SubscriptionBillingCycle } from '../payment/dto/payment.dto';

describe('Subscription Plan Deletion & Sync Specification', () => {
  let subscriptionService: SubscriptionService;
  let paymentService: PaymentService;
  let prisma: PrismaService;

  const mockActivePlan = {
    id: 10,
    name: 'Active Growth Plan',
    code: 'GROWTH',
    description: 'Active standard plan',
    monthlyPrice: 10000,
    yearlyPrice: 100000,
    userLimit: 5,
    leadLimit: 500,
    storageLimit: BigInt(10737418240),
    features: ['Feature 1', 'Feature 2'],
    isActive: true,
    deletedAt: null,
  };

  const mockDeletedPlan = {
    id: 20,
    name: 'Deleted Legacy Plan',
    code: 'LEGACY',
    description: 'Deleted old plan',
    monthlyPrice: 5000,
    yearlyPrice: 50000,
    userLimit: 2,
    leadLimit: 100,
    storageLimit: BigInt(5368709120),
    features: ['Old Feature'],
    isActive: false,
    deletedAt: new Date(),
  };

  const mockInactivePlan = {
    id: 30,
    name: 'Inactive Hidden Plan',
    code: 'HIDDEN',
    description: 'Deactivated plan',
    monthlyPrice: 8000,
    yearlyPrice: 80000,
    userLimit: 3,
    leadLimit: 200,
    storageLimit: BigInt(5368709120),
    features: ['Hidden Feature'],
    isActive: false,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        PaymentService,
        {
          provide: PrismaService,
          useValue: {
            plan: {
              count: jest.fn().mockResolvedValue(3),
              findMany: jest.fn().mockImplementation((args) => {
                const plans = [mockActivePlan, mockDeletedPlan, mockInactivePlan];
                return plans.filter((p) => {
                  if (args?.where?.deletedAt === null && p.deletedAt !== null) return false;
                  if (args?.where?.isActive === true && !p.isActive) return false;
                  return true;
                });
              }),
              findFirst: jest.fn().mockImplementation((args) => {
                const plans = [mockActivePlan, mockDeletedPlan, mockInactivePlan];
                return (
                  plans.find((p) => {
                    if (args?.where?.id && p.id !== args.where.id) return false;
                    if (args?.where?.code && p.code !== args.where.code) return false;
                    if (args?.where?.deletedAt === null && p.deletedAt !== null) return false;
                    if (args?.where?.isActive === true && !p.isActive) return false;
                    return true;
                  }) || null
                );
              }),
              findUnique: jest.fn().mockImplementation((args) => {
                const plans = [mockActivePlan, mockDeletedPlan, mockInactivePlan];
                return plans.find((p) => p.id === args.where.id) || null;
              }),
              update: jest.fn().mockImplementation((args) => {
                return { ...mockActivePlan, ...args.data };
              }),
            },
            customer: {
              findFirst: jest.fn().mockResolvedValue({ id: 1, name: 'Test Customer', email: 'test@example.com' }),
              findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'Test Customer', email: 'test@example.com' }),
            },
            customerSubscription: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({ id: 101, planId: 10, status: 'ACTIVE' }),
            },
            invoice: {
              create: jest.fn().mockResolvedValue({ id: 1, invoiceNumber: 'INV-001' }),
            },
            receipt: {
              create: jest.fn().mockResolvedValue({ id: 1, receiptNumber: 'REC-001' }),
            },
          },
        },
        {
          provide: PlanAccessService,
          useValue: {
            getEffectivePlan: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: ScheduleService,
          useValue: {
            autoGenerateSchedulesForSubscription: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: WorkService,
          useValue: {
            findAll: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            create: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: IntegrationSettingsService,
          useValue: {
            getRazorpayConfig: jest.fn().mockResolvedValue({
              keyId: 'rzp_test_1234567890',
              keySecret: 'secret1234567890',
              source: 'TEST',
            }),
            getPaymentSettings: jest.fn().mockResolvedValue({
              data: { offlinePaymentEnabled: true },
            }),
          },
        },
      ],
    }).compile();

    subscriptionService = module.get<SubscriptionService>(SubscriptionService);
    paymentService = module.get<PaymentService>(PaymentService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('1. Customer Plan List (GET /plans)', () => {
    it('CASE A: returns only active and non-deleted plans to customers', async () => {
      const plans = await subscriptionService.getPlans(false);
      expect(plans).toHaveLength(1);
      expect(plans[0].id).toBe(10);
      expect(plans[0].name).toBe('Active Growth Plan');
      expect(plans[0].isActive).toBe(true);
    });

    it('CASE B: excludes deleted plan (deletedAt !== null) from customer API', async () => {
      const plans = await subscriptionService.getPlans(false);
      const deleted = plans.find((p) => p.id === mockDeletedPlan.id);
      expect(deleted).toBeUndefined();
    });

    it('CASE E: excludes inactive plan (isActive === false) from customer API', async () => {
      const plans = await subscriptionService.getPlans(false);
      const inactive = plans.find((p) => p.id === mockInactivePlan.id);
      expect(inactive).toBeUndefined();
    });

    it('CASE F: returns empty array [] when no active plans exist, never null', async () => {
      jest.spyOn(prisma.plan, 'findMany').mockResolvedValueOnce([]);
      const plans = await subscriptionService.getPlans(false);
      expect(plans).toEqual([]);
      expect(Array.isArray(plans)).toBe(true);
    });
  });

  describe('2. Plan Deletion (DELETE /admin/plans/:id)', () => {
    it('deactivates and sets deletedAt timestamp in database', async () => {
      const res = await subscriptionService.deletePlan(10);
      expect(res.isActive).toBe(false);
      expect(res.deletedAt).toBeDefined();
    });

    it('throws NotFoundException when trying to delete already-deleted plan', async () => {
      await expect(subscriptionService.deletePlan(20)).rejects.toThrow(NotFoundException);
    });
  });

  describe('3. Purchase Validation (POST /payments/razorpay/order)', () => {
    it('CASE C1: rejects purchase of deleted plan with 400 BadRequestException', async () => {
      await expect(
        paymentService.createRazorpayOrder(
          { id: 1, role: 'CUSTOMER', customerId: 1 },
          { planId: 20, billingCycle: SubscriptionBillingCycle.MONTHLY },
          1,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('CASE C2: rejects purchase of inactive plan with 400 BadRequestException', async () => {
      await expect(
        paymentService.createRazorpayOrder(
          { id: 1, role: 'CUSTOMER', customerId: 1 },
          { planId: 30, billingCycle: SubscriptionBillingCycle.MONTHLY },
          1,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('CASE G: rejects purchase of non-existent plan ID with 400 BadRequestException', async () => {
      await expect(
        paymentService.createRazorpayOrder(
          { id: 1, role: 'CUSTOMER', customerId: 1 },
          { planId: 9999, billingCycle: SubscriptionBillingCycle.MONTHLY },
          1,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('CASE D: strictly uses database price for order calculation', async () => {
      // Mock Razorpay client orders.create
      (paymentService as any).getRazorpayClient = jest.fn().mockResolvedValue({
        instance: {
          orders: {
            create: jest.fn().mockResolvedValue({ id: 'order_test123' }),
          },
        },
        config: {
          keyId: 'rzp_test_12345',
          keySecret: 'secret12345',
          source: 'TEST',
        },
      });

      const order = await paymentService.createRazorpayOrder(
        { id: 1, role: 'CUSTOMER', customerId: 1 },
        { planId: 10, billingCycle: SubscriptionBillingCycle.MONTHLY, paymentOption: 'FULL' },
        1,
      );

      // Base 10000 + 18% GST (1800) = 11800
      expect(order.basePriceRupees).toBe(10000);
      expect(order.taxAmountRupees).toBe(1800);
      expect(order.totalAmountRupees).toBe(11800);
    });
  });
});
