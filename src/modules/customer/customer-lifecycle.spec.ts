import { CustomerService } from './customer.service';
import { convertWonLead, recalculateCustomer, deleteCustomersForLeads } from './customer-lifecycle.util';
import { LeadService } from '../lead/lead.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlanAdminGuard } from '../subscription/plan-admin.guard';
const admin = { id: 1, accountType: 'ADMIN' };
const lead = {
  id: 11,
  status: 'WON',
  companyName: 'Test',
  firstName: null,
  lastName: null,
  email: null,
  phone: null,
  createdById: 1,
  assignedToId: null,
};

describe('Won customer conversion', () => {
  it('upserts inactive customers with the original lead, without resetting existing status', async () => {
    const tx = { customer: { upsert: jest.fn().mockResolvedValue({ id: 111, userId: null }) } };
    await convertWonLead(tx as any, lead);
    await convertWonLead(tx as any, lead);
    expect(tx.customer.upsert).toHaveBeenLastCalledWith({
      where: { originLeadId: 11 },
      update: {},
      create: {
        originLeadId: 11,
        companyName: 'Test',
        firstName: null,
        lastName: null,
        email: null,
        phone: null,
        status: 'INACTIVE',
      },
    });
    tx.customer.upsert.mockClear();
    await convertWonLead(tx as any, { ...lead, status: 'NEW' });
    expect(tx.customer.upsert).not.toHaveBeenCalled();
  });
  it('provisions a hashed default login for a newly won customer and keeps it on retries', async () => {
    const bcrypt = require('bcrypt');
    const tx: any = {
      customer: {
        upsert: jest.fn().mockResolvedValue({ id: 112, userId: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 52 }),
      },
    };
    const eligibleLead = { ...lead, email: ' CUSTOMER@example.com ', phone: '9876543210' };
    await convertWonLead(tx, eligibleLead);
    const createdUser = tx.user.create.mock.calls[0][0].data;
    expect(createdUser.email).toBe('customer@example.com');
    expect(createdUser.phone).toBe('+919876543210');
    expect(createdUser.accountType).toBe('CUSTOMER');
    expect(await bcrypt.compare('123456', createdUser.passwordHash)).toBe(true);
    expect(createdUser.passwordHash).not.toBe('123456');
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 112 }, data: { userId: 52 } });

    tx.customer.upsert.mockResolvedValue({ id: 112, userId: 52 });
    await convertWonLead(tx, eligibleLead);
    expect(tx.user.create).toHaveBeenCalledTimes(1);
  });
  it('links an existing unlinked customer login without replacing its password', async () => {
    const tx: any = {
      customer: {
        upsert: jest.fn().mockResolvedValue({ id: 113, userId: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 53, accountType: 'CUSTOMER', customerAccount: null, passwordHash: 'existing-hash' }]),
        create: jest.fn(),
      },
    };
    await convertWonLead(tx, { ...lead, email: 'customer@example.com' });
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 113 }, data: { userId: 53 } });
    expect(tx.user.create).not.toHaveBeenCalled();
  });
  it('performs the stage update and conversion in the same transaction and propagates failure', async () => {
    const tx = {
      lead: { update: jest.fn().mockResolvedValue(lead) },
      customer: {
        upsert: jest.fn().mockRejectedValue(new Error('customer write failed')),
      },
    };
    const prisma = {
      lead: {
        findFirst: jest.fn().mockResolvedValue({ ...lead, status: 'NEW' }),
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    await expect(
      new LeadService(prisma as any).updateStage(
        11,
        { status: 'WON' } as any,
        admin,
      ),
    ).rejects.toThrow('customer write failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.lead.update).toHaveBeenCalled();
  });

  it('deletes customers, cancels subscriptions, and deactivates users for deleted leads', async () => {
    const tx = {
      customer: {
        findMany: jest.fn().mockResolvedValue([{ id: 11, userId: 44 }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customerSubscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const now = new Date('2026-10-17');
    await deleteCustomersForLeads(tx as any, [11], now);
    expect(tx.customer.findMany).toHaveBeenCalledWith({
      where: { originLeadId: { in: [11] }, deletedAt: null },
      select: { id: true, userId: true },
    });
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [11] } },
      data: { deletedAt: now },
    });
    expect(tx.customerSubscription.updateMany).toHaveBeenCalledWith({
      where: {
        customerId: { in: [11] },
        status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] },
      },
      data: { status: 'CANCELLED' },
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [44] }, accountType: 'CUSTOMER' },
      data: { isActive: false, deletedAt: now },
    });
  });

  it('list excludes customers whose lead is deleted', async () => {
    const prisma = {
      customer: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new CustomerService(prisma as any);
    await service.list(admin);
    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          lead: { deletedAt: null },
        }),
      }),
    );
  });
});

describe('subscription lifecycle', () => {
  it.each([0, 1, 2])(
    'derives customer state from all %s qualifying subscriptions',
    async (activeCount) => {
      const tx = {
        $queryRaw: jest.fn(),
        customerSubscription: {
          updateMany: jest.fn(),
          count: jest.fn().mockResolvedValue(activeCount),
        },
        customer: { update: jest.fn() },
      };
      await recalculateCustomer(tx as any, 9, new Date('2026-10-17'));
      expect(tx.customerSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'EXPIRED' } }),
      );
      expect(tx.customerSubscription.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 9,
            status: 'ACTIVE',
            checkout: { status: 'PAID' },
          }),
        }),
      );
      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { status: activeCount ? 'ACTIVE' : 'INACTIVE' },
      });
    },
  );
  it('cancels one subscription under the customer lock and recalculates remaining subscriptions', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      customerSubscription: {
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      customer: { update: jest.fn() },
    };
    const prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 9, userId: 3 }),
      },
      customerSubscription: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, customerId: 9 }),
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    await new CustomerService(prisma as any).cancel(7, { id: 3 });
    expect(tx.customerSubscription.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'CANCELLED' },
    });
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'ACTIVE' },
    });
  });
  it('rejects access to another customer and conflicting retries', async () => {
    const prisma: any = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 9, userId: 3 }),
      },
      customerCheckout: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ planId: 2, billingCycle: 'YEARLY' }),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(fn => fn(prisma)),
    };
    const service = new CustomerService(prisma as any);
    await expect(service.authorize({ id: 4 }, 9)).rejects.toThrow(
      'access denied',
    );
    await expect(
      service.prepare(
        { id: 3 },
        { planId: 1, billingCycle: 'MONTHLY', idempotencyKey: 'retry-key' },
      ),
    ).rejects.toThrow('another purchase');
  });
  it('rejects uncaptured payments and mismatched amounts before starting a transaction', async () => {
    const prisma = {
      customerCheckout: {
        findUnique: jest.fn().mockResolvedValue({ totalPaise: 11800 }),
      },
      $transaction: jest.fn(),
    };
    const service = new CustomerService(prisma as any);
    const payment = {
      id: 'pay',
      order_id: 'order',
      amount: 11800,
      currency: 'INR',
      status: 'captured',
    };
    for (const change of [
      { status: 'failed' },
      { status: 'authorized' },
      { amount: 1 },
      { currency: 'USD' },
      { order_id: 'other' },
    ])
      await expect(
        service.settle('order', { ...payment, ...change }),
      ).rejects.toThrow('matching captured');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('settles concurrent verified callbacks once and never reactivates a cancelled subscription on retry', async () => {
    let checkout: any = {
      id: 'checkout',
      customerId: 9,
      planId: 1,
      billingCycle: 'MONTHLY',
      status: 'PENDING',
      totalPaise: 11800,
      basePaise: 10000,
      discountPaise: 0,
      taxablePaise: 10000,
      gstPaise: 1800,
    };
    let subscription: any;
    const tx: any = {
      $queryRaw: jest.fn(),
      customerCheckout: {
        findUniqueOrThrow: jest.fn(async () => checkout),
        update: jest.fn(
          async ({ data }) => (checkout = { ...checkout, ...data }),
        ),
      },
      plan: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Test plan' }),
      },
      paymentHistory: { create: jest.fn().mockResolvedValue({ id: 2 }) },
      customerSubscription: {
        create: jest.fn(
          async ({ data }) => (subscription = { id: 7, ...data }),
        ),
        findUnique: jest.fn(async () => subscription),
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      customer: { update: jest.fn() },
    };
    // Serialize transactions as the real customer row lock does. DB lock behavior needs PostgreSQL integration testing.
    let queue = Promise.resolve();
    const prisma: any = {
      customerCheckout: { findUnique: jest.fn(async () => checkout) },
      $transaction: jest.fn((fn) => {
        const pending = queue.then(() => fn(tx));
        queue = pending.then(() => undefined);
        return pending;
      }),
    };
    const service = new CustomerService(prisma);
    const payment = {
      id: 'payment',
      order_id: 'order',
      amount: 11800,
      currency: 'INR',
      status: 'captured',
    };
    const results = await Promise.all([
      service.settle('order', payment),
      service.settle('order', payment),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(tx.customerSubscription.create).toHaveBeenCalledTimes(1);
    expect(tx.paymentHistory.create).toHaveBeenCalledTimes(1);
    subscription.status = 'CANCELLED';
    await service.settle('order', payment);
    expect(subscription.status).toBe('CANCELLED');
    expect(tx.customerSubscription.create).toHaveBeenCalledTimes(1);
  });
  it('blocks customer JWT principals from non-billing controllers and non-admin plan changes', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const context: any = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 3, accountType: 'CUSTOMER' } }),
      }),
    };
    expect(() =>
      new JwtAuthGuard(reflector as any).handleRequest(
        null,
        { id: 3, accountType: 'CUSTOMER' },
        null,
        context,
      ),
    ).toThrow('billing access only');
    expect(() => new PlanAdminGuard().canActivate(context)).toThrow(
      'Administrator required',
    );
  });
});
