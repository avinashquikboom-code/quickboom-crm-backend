import { Test, TestingModule } from '@nestjs/testing';
import {
  InstallmentService,
  DEFAULT_BUFFER_DAYS,
  TERMS_CONDITIONS_RENEWAL_FAILED,
  TERMS_CONDITIONS_BUFFER_ACTIVE,
} from './installment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InstallmentStatus, SubscriptionStatus, PaymentMethod } from '@prisma/client';

describe('Advance Payment & Installment Renewal Business Logic (Final Rules)', () => {
  let installmentService: InstallmentService;
  let prisma: PrismaService;

  // In-memory mock storage for testing
  let mockInstallments: any[] = [];
  let mockPayments: any[] = [];
  let mockInvoices: any[] = [];
  let mockSubscriptions: any[] = [];
  let mockCustomers: any[] = [];
  let mockPlans: any[] = [];

  beforeEach(async () => {
    mockInstallments = [];
    mockPayments = [];
    mockInvoices = [];
    mockPlans = [
      {
        id: 1,
        name: 'Social Media Package',
        code: 'SMP-30K',
        monthlyPrice: 25423.73, // 30,000 with 18% GST
        yearlyPrice: 254237.29,
        userLimit: 5,
        leadLimit: 100,
        storageLimit: 10737418240,
        features: ['Reels', 'Posts'],
      },
    ];
    mockSubscriptions = [
      {
        id: 101,
        customerId: 1,
        planId: 1,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'MONTHLY',
        startDate: new Date('2026-07-20T00:00:00.000Z'),
        endDate: new Date('2026-08-20T00:00:00.000Z'),
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        plan: mockPlans[0],
        installments: [],
        payments: [],
      },
    ];
    mockCustomers = [
      { id: 1, name: 'Care Fitness Gym', email: 'care@fitness.com', isActive: true },
      { id: 2, name: 'ABC Fitness', email: 'abc@fitness.com', isActive: true },
    ];

    const mockPrisma = {
      plan: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          return mockPlans.find((p) => p.id === where.id) || null;
        }),
      },
      subscriptionInstallment: {
        create: jest.fn().mockImplementation(({ data }) => {
          const item = { id: mockInstallments.length + 1, ...data };
          mockInstallments.push(item);
          return item;
        }),
        findMany: jest.fn().mockImplementation(({ where, orderBy }) => {
          let list = mockInstallments.filter((i) => {
            if (where?.subscriptionId && i.subscriptionId !== where.subscriptionId) return false;
            if (where?.customerId && i.customerId !== where.customerId) return false;
            if (where?.status && typeof where.status === 'object' && where.status.in) {
              return where.status.in.includes(i.status);
            }
            if (where?.status && i.status !== where.status) return false;
            if (where?.installmentNumber && typeof where.installmentNumber === 'object') {
              if (where.installmentNumber.lt !== undefined && i.installmentNumber >= where.installmentNumber.lt) return false;
            }
            return true;
          });
          if (orderBy?.installmentNumber === 'desc') {
            list = [...list].sort((a, b) => b.installmentNumber - a.installmentNumber);
          } else {
            list = [...list].sort((a, b) => a.installmentNumber - b.installmentNumber);
          }
          return list;
        }),
        findFirst: jest.fn().mockImplementation(({ where }) => {
          return (
            mockInstallments.find((i) => {
              if (where?.id && i.id !== where.id) return false;
              if (where?.subscriptionId && i.subscriptionId !== where.subscriptionId) return false;
              if (where?.customerId && i.customerId !== where.customerId) return false;
              if (where?.installmentNumber && i.installmentNumber !== where.installmentNumber) return false;
              return true;
            }) || null
          );
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const idx = mockInstallments.findIndex((i) => i.id === where.id);
          if (idx >= 0) {
            mockInstallments[idx] = { ...mockInstallments[idx], ...data };
            return mockInstallments[idx];
          }
          return null;
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          let count = 0;
          mockInstallments.forEach((i) => {
            if (where?.subscriptionId && i.subscriptionId !== where.subscriptionId) return;
            if (where?.status?.in && !where.status.in.includes(i.status)) return;
            Object.assign(i, data);
            count++;
          });
          return { count };
        }),
        deleteMany: jest.fn().mockImplementation(({ where }) => {
          mockInstallments = mockInstallments.filter((i) => {
            if (where?.subscriptionId && i.subscriptionId === where.subscriptionId) {
              if (where?.status?.in && where.status.in.includes(i.status)) return false;
              if (!where?.status) return false;
            }
            return true;
          });
          return { count: 1 };
        }),
      },
      customerSubscription: {
        create: jest.fn().mockImplementation(({ data }) => {
          const sub = {
            id: mockSubscriptions.length + 101,
            ...data,
            createdAt: new Date(),
            plan: mockPlans.find((p) => p.id === data.planId) || mockPlans[0],
            installments: [],
            payments: [],
          };
          mockSubscriptions.push(sub);
          return sub;
        }),
        findFirst: jest.fn().mockImplementation(({ where, orderBy }) => {
          let list = mockSubscriptions.filter((s) => s.customerId === where?.customerId && !s.deletedAt);
          if (orderBy?.createdAt === 'desc') {
            list = [...list].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
          }
          const sub = list[0] || null;
          if (sub) {
            return {
              ...sub,
              installments: mockInstallments.filter((i) => i.subscriptionId === sub.id),
              payments: mockPayments.filter((p) => p.subscriptionId === sub.id),
            };
          }
          return null;
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const idx = mockSubscriptions.findIndex((s) => s.id === where.id);
          if (idx >= 0) {
            mockSubscriptions[idx] = { ...mockSubscriptions[idx], ...data };
            return mockSubscriptions[idx];
          }
          return null;
        }),
      },
      customer: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          return mockCustomers.find((c) => c.id === where.id) || null;
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const idx = mockCustomers.findIndex((c) => c.id === where.id);
          if (idx >= 0) {
            mockCustomers[idx] = { ...mockCustomers[idx], ...data };
            return mockCustomers[idx];
          }
          return null;
        }),
      },
      contact: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, customerId: 1, firstName: 'Care', lastName: 'Fitness' }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 1, ...data })),
      },
      paymentHistory: {
        create: jest.fn().mockImplementation(({ data }) => {
          const p = { id: mockPayments.length + 1, ...data };
          mockPayments.push(p);
          return p;
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const idx = mockPayments.findIndex((p) => p.id === where.id);
          if (idx >= 0) {
            mockPayments[idx] = { ...mockPayments[idx], ...data };
            return mockPayments[idx];
          }
          return null;
        }),
      },
      invoice: {
        create: jest.fn().mockImplementation(({ data }) => {
          const inv = { id: mockInvoices.length + 1, ...data };
          mockInvoices.push(inv);
          return inv;
        }),
        findFirst: jest.fn().mockImplementation(({ where }) => {
          return mockInvoices.find((inv) => inv.invoiceNo === where.invoiceNo) || null;
        }),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(mockPrisma);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstallmentService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    installmentService = module.get<InstallmentService>(InstallmentService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  // TEST 1: Customer pays Installment 1. Buffer has not started. Expected: ACTIVE.
  it('TEST 1: Customer pays Installment 1. Buffer has not started -> Status is ACTIVE', async () => {
    const totalPlanAmount = 30000;
    await installmentService.createInstallmentsForSubscription(
      1,
      101,
      totalPlanAmount,
      3,
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // Started 5 days ago
    );

    // Pay Installment 1
    const payResult = await installmentService.payInstallment(1, mockInstallments[0].id, {
      paymentMethod: PaymentMethod.RAZORPAY,
    });
    expect(payResult.success).toBe(true);

    const summary = await installmentService.getCustomerInstallmentSummary(1);
    expect(summary.planStatus).toBe('ACTIVE');
    expect(summary.isAccessAllowed).toBe(true);
    expect(summary.isInBuffer).toBe(false);
    expect(summary.isRenewalFailed).toBe(false);
    expect(summary.totalPaidAmount).toBe(10000);
    expect(summary.outstandingAmount).toBe(20000);
  });

  // TEST 2: Installment expires. Expected: BUFFER_PERIOD. Customer can renew.
  it('TEST 2: Installment 1 expires -> Status is BUFFER_PERIOD with 3 days grace and can renew', async () => {
    // Installment 1 expired yesterday (31 days ago start)
    const startDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await installmentService.createInstallmentsForSubscription(1, 101, 30000, 3, startDate);

    // Mark Installment 1 as paid
    mockInstallments[0].status = InstallmentStatus.PAID;
    mockInstallments[0].paidAt = startDate;

    const summary = await installmentService.getCustomerInstallmentSummary(1);
    expect(summary.planStatus).toBe('BUFFER_PERIOD');
    expect(summary.isInBuffer).toBe(true);
    expect(summary.isAccessAllowed).toBe(true);
    expect(summary.canRenewCurrentPlan).toBe(true);
    expect(summary.isRenewalFailed).toBe(false);
    expect(summary.bufferRemainingDays).toBeGreaterThanOrEqual(1);
    expect(summary.amountRequiredToContinue).toBe(10000);
    expect(summary.bufferMessage).toContain('buffer period');
  });

  // TEST 3: Customer renews during buffer. Expected: RENEWED / ACTIVE. Existing installment plan continues.
  it('TEST 3: Customer renews during buffer -> Plan continues without restarting or charging full amount', async () => {
    const startDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await installmentService.createInstallmentsForSubscription(1, 101, 30000, 3, startDate);

    mockInstallments[0].status = InstallmentStatus.PAID;
    mockInstallments[0].paidAt = startDate;

    // Customer pays Installment 2 during buffer
    const payResult = await installmentService.payInstallment(1, mockInstallments[1].id, {
      paymentMethod: PaymentMethod.RAZORPAY,
    });
    expect(payResult.success).toBe(true);
    expect(mockInstallments[1].status).toBe(InstallmentStatus.PAID);

    const summary = await installmentService.getCustomerInstallmentSummary(1);
    expect(summary.totalPaidAmount).toBe(20000);
    expect(summary.outstandingAmount).toBe(10000);
    expect(summary.isAccessAllowed).toBe(true);
    expect(summary.isRenewalFailed).toBe(false);
    expect(summary.installments[2].status).toBe(InstallmentStatus.DUE);
  });

  // TEST 4: Customer does NOT renew. Buffer expires. Expected: RENEWAL_FAILED. Old plan cannot continue.
  it('TEST 4: Customer does NOT renew within buffer -> Status is RENEWAL_FAILED and old plan cannot continue', async () => {
    // Installment 1 expired 35 days ago (buffer ended 32 days ago)
    const startDate = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000);
    await installmentService.createInstallmentsForSubscription(1, 101, 30000, 3, startDate);

    mockInstallments[0].status = InstallmentStatus.PAID;
    mockInstallments[0].paidAt = startDate;

    const summary = await installmentService.getCustomerInstallmentSummary(1);
    expect(summary.planStatus).toBe('RENEWAL_FAILED');
    expect(summary.isRenewalFailed).toBe(true);
    expect(summary.isAccessAllowed).toBe(false);
    expect(summary.canRenewCurrentPlan).toBe(false);
    expect(summary.failureMessage).toContain('expired');
    expect(summary.termsMessage).toBe(TERMS_CONDITIONS_RENEWAL_FAILED);

    // Attempting to pay old installment now throws error
    await expect(
      installmentService.payInstallment(1, mockInstallments[1].id),
    ).rejects.toThrow('renewal period has expired');
  });

  // TEST 5: After renewal failure: Original Plan: ₹30,000, Historical Paid: ₹10,000. Required to Start: ₹30,000, NOT ₹20,000.
  it('TEST 5: After renewal failure, Required to Start Again is ₹30,000 (Full Price), NOT ₹20,000', async () => {
    const startDate = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000);
    await installmentService.createInstallmentsForSubscription(1, 101, 30000, 3, startDate);

    mockInstallments[0].status = InstallmentStatus.PAID;
    mockInstallments[0].paidAt = startDate;

    const summary = await installmentService.getCustomerInstallmentSummary(1);
    expect(summary.originalPlanValue).toBe(30000);
    expect(summary.historicalPaidAmount).toBe(10000);
    expect(summary.amountRequiredToRestart).toBe(30000);
    expect(summary.newPlanPrice).toBe(30000);
    expect(summary.amountRequiredToContinue).toBeNull();
  });

  // TEST 6: Customer purchases new plan: New Subscription ID, New Order ID, New billing cycle, New schedule.
  it('TEST 6: Customer purchases new plan -> Creates distinct Subscription, Order, and fresh installment schedule', async () => {
    const startDate = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000);
    await installmentService.createInstallmentsForSubscription(1, 101, 30000, 3, startDate);
    mockInstallments[0].status = InstallmentStatus.PAID;

    // Customer clicks "Start New Plan"
    const newPlanResult = await installmentService.startNewPlan(1, {
      planId: 1,
      totalInstallments: 3,
      paymentMethod: PaymentMethod.RAZORPAY,
    });

    expect(newPlanResult.success).toBe(true);
    expect(newPlanResult.newSubscriptionId).not.toBe(101);
    expect(newPlanResult.orderNumber).toBeDefined();

    // Verify fresh schedule
    const newSummary = newPlanResult.summary;
    expect(newSummary.subscriptionId).toBe(newPlanResult.newSubscriptionId);
    expect(newSummary.planStatus).toBe('ACTIVE');
    expect(newSummary.isAccessAllowed).toBe(true);
    expect(newSummary.totalPlanAmount).toBe(30000);
    expect(newSummary.totalPaidAmount).toBe(10000); // 1st installment of new plan
    expect(newSummary.outstandingAmount).toBe(20000);
    expect(newSummary.isRenewalFailed).toBe(false);
  });
});
