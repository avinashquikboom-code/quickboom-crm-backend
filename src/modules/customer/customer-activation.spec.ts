import { calculateActivationDate, calculatePlanExpiry } from '../../common/utils/subscription-date.util';
import { BUSINESS_TIMEZONE } from '../../common/utils/timezone.util';
import { recalculateCustomer } from './customer-lifecycle.util';
import { CustomerService } from './customer.service';

describe('Feature: Activate Customer Subscription After 2 Days', () => {
  describe('1. Date Arithmetic & Timezone Calculations', () => {
    it('calculates activation date exactly 2 calendar days after purchase in business timezone (1 July -> 3 July)', () => {
      // Purchase at 2026-07-01 14:30:00 IST (UTC: 2026-07-01 09:00:00Z)
      const purchaseUtc = new Date('2026-07-01T09:00:00.000Z');
      const activationDate = calculateActivationDate(purchaseUtc, BUSINESS_TIMEZONE);

      // In IST, 09:00:00Z is 14:30:00. +2 calendar days = 2026-07-03 14:30:00 IST (09:00:00Z)
      expect(activationDate.toISOString()).toBe('2026-07-03T09:00:00.000Z');
    });

    it('handles month-end rollovers correctly', () => {
      // 30 Jan -> 1 Feb
      const jan30 = new Date('2026-01-30T10:00:00.000Z');
      const feb1 = calculateActivationDate(jan30, BUSINESS_TIMEZONE);
      expect(feb1.toISOString()).toBe('2026-02-01T10:00:00.000Z');

      // 31 Jan -> 2 Feb
      const jan31 = new Date('2026-01-31T10:00:00.000Z');
      const feb2 = calculateActivationDate(jan31, BUSINESS_TIMEZONE);
      expect(feb2.toISOString()).toBe('2026-02-02T10:00:00.000Z');

      // 31 March -> 2 April
      const mar31 = new Date('2026-03-31T05:00:00.000Z');
      const apr2 = calculateActivationDate(mar31, BUSINESS_TIMEZONE);
      expect(apr2.toISOString()).toBe('2026-04-02T05:00:00.000Z');

      // 30 April -> 2 May
      const apr30 = new Date('2026-04-30T08:00:00.000Z');
      const may2 = calculateActivationDate(apr30, BUSINESS_TIMEZONE);
      expect(may2.toISOString()).toBe('2026-05-02T08:00:00.000Z');
    });

    it('handles year-end rollovers correctly', () => {
      // 30 Dec 2026 -> 1 Jan 2027
      const dec30 = new Date('2026-12-30T11:00:00.000Z');
      const jan1 = calculateActivationDate(dec30, BUSINESS_TIMEZONE);
      expect(jan1.toISOString()).toBe('2027-01-01T11:00:00.000Z');

      // 31 Dec 2026 -> 2 Jan 2027
      const dec31 = new Date('2026-12-31T11:00:00.000Z');
      const jan2 = calculateActivationDate(dec31, BUSINESS_TIMEZONE);
      expect(jan2.toISOString()).toBe('2027-01-02T11:00:00.000Z');
    });

    it('handles leap day boundary in leap year (2024)', () => {
      // 27 Feb 2024 -> 29 Feb 2024
      const feb27Leap = new Date('2024-02-27T07:00:00.000Z');
      const feb29Leap = calculateActivationDate(feb27Leap, BUSINESS_TIMEZONE);
      expect(feb29Leap.toISOString()).toBe('2024-02-29T07:00:00.000Z');

      // 28 Feb 2024 -> 1 March 2024
      const feb28Leap = new Date('2024-02-28T07:00:00.000Z');
      const mar1Leap = calculateActivationDate(feb28Leap, BUSINESS_TIMEZONE);
      expect(mar1Leap.toISOString()).toBe('2024-03-01T07:00:00.000Z');

      // 29 Feb 2024 -> 2 March 2024
      const feb29 = new Date('2024-02-29T07:00:00.000Z');
      const mar2Leap = calculateActivationDate(feb29, BUSINESS_TIMEZONE);
      expect(mar2Leap.toISOString()).toBe('2024-03-02T07:00:00.000Z');
    });

    it('handles non-leap year boundary (2025)', () => {
      // 27 Feb 2025 -> 1 March 2025
      const feb27NonLeap = new Date('2025-02-27T07:00:00.000Z');
      const mar1NonLeap = calculateActivationDate(feb27NonLeap, BUSINESS_TIMEZONE);
      expect(mar1NonLeap.toISOString()).toBe('2025-03-01T07:00:00.000Z');

      // 28 Feb 2025 -> 2 March 2025
      const feb28NonLeap = new Date('2025-02-28T07:00:00.000Z');
      const mar2NonLeap = calculateActivationDate(feb28NonLeap, BUSINESS_TIMEZONE);
      expect(mar2NonLeap.toISOString()).toBe('2025-03-02T07:00:00.000Z');
    });

    it('respects timezone boundary when purchase is early morning IST but previous day UTC', () => {
      // Purchase at 2026-07-01 01:30:00 IST
      // In UTC, this is 2026-06-30T20:00:00.000Z (previous calendar day in UTC!)
      const purchaseUtc = new Date('2026-06-30T20:00:00.000Z');
      const activationDate = calculateActivationDate(purchaseUtc, BUSINESS_TIMEZONE);

      // In Asia/Kolkata business timezone, purchase date is July 1st.
      // 2 calendar days after July 1st is July 3rd at 01:30:00 IST.
      // In UTC: 2026-07-02T20:00:00.000Z.
      expect(activationDate.toISOString()).toBe('2026-07-02T20:00:00.000Z');
    });

    it('respects timezone boundary when purchase is late night IST', () => {
      // Purchase at 2026-07-01 23:45:00 IST
      // In UTC, this is 2026-07-01T18:15:00.000Z
      const purchaseUtc = new Date('2026-07-01T18:15:00.000Z');
      const activationDate = calculateActivationDate(purchaseUtc, BUSINESS_TIMEZONE);

      // In Asia/Kolkata, purchase is July 1st.
      // Activation is July 3rd at 23:45:00 IST (UTC: 2026-07-03T18:15:00.000Z).
      expect(activationDate.toISOString()).toBe('2026-07-03T18:15:00.000Z');
    });
  });

  describe('2. Lifecycle State & Idempotent Activation Logic', () => {
    it('keeps customer INACTIVE and subscription PENDING_ACTIVATION before activation date', async () => {
      const mockTx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        customerSubscription: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          count: jest.fn().mockResolvedValue(0), // 0 active subscriptions
        },
        customer: {
          update: jest.fn().mockImplementation(({ data }) => ({ id: 10, status: data.status })),
        },
      };

      const beforeActivation = new Date('2026-07-02T12:00:00.000Z');
      const customer = await recalculateCustomer(mockTx, 10, beforeActivation);

      expect(customer.status).toBe('INACTIVE');
      // Should not promote pending subscriptions whose activationDate has not arrived
      expect(mockTx.customerSubscription.updateMany).toHaveBeenCalledWith({
        where: {
          customerId: 10,
          status: 'PENDING_ACTIVATION',
          OR: [
            { activationDate: { lte: beforeActivation } },
            { activationDate: null, startDate: { lte: beforeActivation } },
          ],
          checkout: { status: 'PAID' },
        },
        data: { status: 'ACTIVE' },
      });
    });

    it('promotes subscription to ACTIVE and customer to ACTIVE on activation date', async () => {
      const mockTx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        customerSubscription: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }), // 1 pending activated
          count: jest.fn().mockResolvedValue(1), // now 1 active subscription
        },
        customer: {
          update: jest.fn().mockImplementation(({ data }) => ({ id: 10, status: data.status })),
        },
      };

      const onActivation = new Date('2026-07-03T14:30:00.000Z');
      const customer = await recalculateCustomer(mockTx, 10, onActivation);

      expect(customer.status).toBe('ACTIVE');
    });

    it('does not activate cancelled or refunded subscriptions on activation date', async () => {
      const mockTx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        customerSubscription: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          count: jest.fn().mockResolvedValue(0), // cancelled subscriptions don't count
        },
        customer: {
          update: jest.fn().mockImplementation(({ data }) => ({ id: 10, status: data.status })),
        },
      };

      const onActivation = new Date('2026-07-03T14:30:00.000Z');
      const customer = await recalculateCustomer(mockTx, 10, onActivation);

      expect(customer.status).toBe('INACTIVE');
    });

    it('is idempotent: multiple recalculations or job runs produce consistent state', async () => {
      const mockTx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        customerSubscription: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }), // already active, 0 new updates
          count: jest.fn().mockResolvedValue(1),
        },
        customer: {
          update: jest.fn().mockImplementation(({ data }) => ({ id: 10, status: data.status })),
        },
      };

      const afterActivation = new Date('2026-07-04T12:00:00.000Z');
      const res1 = await recalculateCustomer(mockTx, 10, afterActivation);
      const res2 = await recalculateCustomer(mockTx, 10, afterActivation);

      expect(res1.status).toBe('ACTIVE');
      expect(res2.status).toBe('ACTIVE');
    });
  });

  describe('3. CustomerService Settle & Background Activation', () => {
    let service: CustomerService;
    let mockPrisma: any;

    beforeEach(() => {
      mockPrisma = {
        customerCheckout: {
          findUnique: jest.fn(),
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
        },
        customerSubscription: {
          create: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn(),
          count: jest.fn(),
        },
        paymentHistory: {
          create: jest.fn(),
        },
        plan: {
          findUniqueOrThrow: jest.fn(),
        },
        customer: {
          update: jest.fn(),
          findMany: jest.fn(),
        },
        $transaction: jest.fn().mockImplementation(async (callback) => {
          return callback({
            $queryRaw: jest.fn().mockResolvedValue([]),
            customerCheckout: mockPrisma.customerCheckout,
            customerSubscription: mockPrisma.customerSubscription,
            paymentHistory: mockPrisma.paymentHistory,
            plan: mockPrisma.plan,
            customer: mockPrisma.customer,
          });
        }),
      };

      service = new CustomerService(mockPrisma);
    });

    afterEach(() => {
      service.onModuleDestroy();
    });

    it('creates subscription as PENDING_ACTIVATION and sets activationDate 2 days later upon verified payment', async () => {
      const checkout = {
        id: 'chk_123',
        customerId: 5,
        planId: 2,
        totalPaise: 499900,
        taxablePaise: 423644,
        basePaise: 499900,
        discountPaise: 0,
        gstPaise: 76256,
        billingCycle: 'MONTHLY',
        status: 'PENDING',
      };

      mockPrisma.customerCheckout.findUnique.mockResolvedValue(checkout);
      mockPrisma.customerCheckout.findUniqueOrThrow.mockResolvedValue(checkout);
      mockPrisma.plan.findUniqueOrThrow.mockResolvedValue({ id: 2, name: 'Growth Plan' });
      mockPrisma.paymentHistory.create.mockResolvedValue({ id: 88 });
      mockPrisma.customerCheckout.update.mockResolvedValue({ ...checkout, status: 'PAID' });
      mockPrisma.customerSubscription.create.mockImplementation(({ data }) => ({ id: 50, ...data }));
      mockPrisma.customerSubscription.count.mockResolvedValue(0); // 0 ACTIVE (as it is PENDING_ACTIVATION)
      mockPrisma.customer.update.mockResolvedValue({ id: 5, status: 'INACTIVE' });

      const payment = {
        id: 'pay_999',
        order_id: 'order_123',
        status: 'captured',
        amount: 499900,
        currency: 'INR',
      };

      const result = await service.settle('order_123', payment);

      expect(result.status).toBe('PENDING_ACTIVATION');
      expect(result.activationDate).toBeDefined();

      // Check difference between purchase date (createdAt) and activationDate
      const diffMs = result.activationDate.getTime() - result.createdAt.getTime();
      const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(2);

      // Customer status updated to INACTIVE
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5 },
          data: { status: 'INACTIVE' },
        }),
      );
    });

    it('rejects unverified or failed payment and does not create subscription or activate', async () => {
      const checkout = {
        id: 'chk_123',
        customerId: 5,
        planId: 2,
        totalPaise: 499900,
      };
      mockPrisma.customerCheckout.findUnique.mockResolvedValue(checkout);

      // Payment with mismatched amount or failed status
      const payment = {
        id: 'pay_failed',
        order_id: 'order_123',
        status: 'failed',
        amount: 499900,
        currency: 'INR',
      };

      await expect(service.settle('order_123', payment)).rejects.toThrow();
      expect(mockPrisma.customerSubscription.create).not.toHaveBeenCalled();
    });

    it('handles delayed jobs safely: activates all eligible overdue pending subscriptions', async () => {
      const pastActivationDate = new Date('2026-07-03T10:00:00.000Z');
      const nowDelayed = new Date('2026-07-05T12:00:00.000Z'); // 2 days delayed!

      const pendingSub = {
        id: 77,
        customerId: 9,
        planId: 2,
        checkoutId: 'chk_77',
        status: 'PENDING_ACTIVATION',
        activationDate: pastActivationDate,
        startDate: pastActivationDate,
        checkout: { status: 'PAID' },
      };

      mockPrisma.customerSubscription.findMany.mockResolvedValue([pendingSub]);
      mockPrisma.customerSubscription.findUnique.mockResolvedValue(pendingSub);
      mockPrisma.customerCheckout.findUnique.mockResolvedValue({ id: 'chk_77', status: 'PAID' });
      mockPrisma.customerSubscription.update.mockResolvedValue({ ...pendingSub, status: 'ACTIVE' });
      mockPrisma.customerSubscription.count.mockResolvedValue(1);
      mockPrisma.customer.update.mockResolvedValue({ id: 9, status: 'ACTIVE' });

      const res = await service.activatePendingSubscriptions(nowDelayed);

      expect(res.activatedCount).toBe(1);
      expect(mockPrisma.customerSubscription.update).toHaveBeenCalledWith({
        where: { id: 77 },
        data: { status: 'ACTIVE' },
      });
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 9 },
          data: { status: 'ACTIVE' },
        }),
      );
    });

    it('duplicate webhook / settle calls return existing subscription without re-creating', async () => {
      const checkout = {
        id: 'chk_dup',
        customerId: 3,
        status: 'PAID',
        totalPaise: 499900,
      };
      const existingSub = {
        id: 42,
        customerId: 3,
        status: 'PENDING_ACTIVATION',
        activationDate: new Date('2026-07-03T10:00:00.000Z'),
      };

      mockPrisma.customerCheckout.findUnique.mockResolvedValue(checkout);
      mockPrisma.customerCheckout.findUniqueOrThrow.mockResolvedValue(checkout);
      mockPrisma.customerSubscription.findUnique.mockResolvedValue(existingSub);

      const payment = {
        id: 'pay_dup',
        order_id: 'order_dup',
        status: 'captured',
        amount: 499900,
        currency: 'INR',
      };

      const result = await service.settle('order_dup', payment);

      expect(result).toEqual(existingSub);
      expect(mockPrisma.customerSubscription.create).not.toHaveBeenCalled();
    });
  });
});
