import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('Customer-Specific Cascade Delete for Invoices & Billing', () => {
  let service: CustomerService;

  // In-memory data store mimicking database tables
  let customers: any[] = [];
  let invoices: any[] = [];
  let invoiceItems: any[] = [];
  let payments: any[] = [];
  let subscriptions: any[] = [];
  let installments: any[] = [];
  let customPlanOrders: any[] = [];
  let monthlySchedules: any[] = [];
  let users: any[] = [];
  let refreshTokens: any[] = [];
  let sessions: any[] = [];

  const mockPrismaService: any = {
    customer: {
      findUnique: jest.fn(({ where }) => {
        return Promise.resolve(customers.find((c) => c.id === where.id) || null);
      }),
      update: jest.fn(({ where, data }) => {
        const idx = customers.findIndex((c) => c.id === where.id);
        if (idx !== -1) {
          customers[idx] = { ...customers[idx], ...data };
          return Promise.resolve(customers[idx]);
        }
        return Promise.resolve(null);
      }),
      delete: jest.fn(({ where }) => {
        const idx = customers.findIndex((c) => c.id === where.id);
        if (idx !== -1) {
          const removed = customers.splice(idx, 1)[0];
          return Promise.resolve(removed);
        }
        return Promise.resolve(null);
      }),
    },
    $transaction: jest.fn(async (callback: any) => {
      // Create mock tx client
      const tx = {
        subscriptionInstallment: {
          deleteMany: jest.fn(({ where }) => {
            const initial = installments.length;
            installments = installments.filter((i) => i.customerId !== where.customerId);
            return Promise.resolve({ count: initial - installments.length });
          }),
        },
        invoiceItem: {
          deleteMany: jest.fn(({ where }) => {
            const targetCustomerInvoices = invoices
              .filter((inv) => inv.customerId === where.invoice.customerId)
              .map((inv) => inv.id);
            const initial = invoiceItems.length;
            invoiceItems = invoiceItems.filter((item) => !targetCustomerInvoices.includes(item.invoiceId));
            return Promise.resolve({ count: initial - invoiceItems.length });
          }),
        },
        invoice: {
          deleteMany: jest.fn(({ where }) => {
            const initial = invoices.length;
            invoices = invoices.filter((inv) => inv.customerId !== where.customerId);
            return Promise.resolve({ count: initial - invoices.length });
          }),
        },
        paymentHistory: {
          deleteMany: jest.fn(({ where }) => {
            const initial = payments.length;
            payments = payments.filter((p) => p.customerId !== where.customerId);
            return Promise.resolve({ count: initial - payments.length });
          }),
        },
        customPlanOrder: {
          deleteMany: jest.fn(({ where }) => {
            const initial = customPlanOrders.length;
            customPlanOrders = customPlanOrders.filter((o) => o.customerId !== where.customerId);
            return Promise.resolve({ count: initial - customPlanOrders.length });
          }),
        },
        monthlySchedule: {
          deleteMany: jest.fn(({ where }) => {
            const initial = monthlySchedules.length;
            monthlySchedules = monthlySchedules.filter((s) => s.customerId !== where.customerId);
            return Promise.resolve({ count: initial - monthlySchedules.length });
          }),
        },
        customerSubscription: {
          deleteMany: jest.fn(({ where }) => {
            const initial = subscriptions.length;
            subscriptions = subscriptions.filter((s) => s.customerId !== where.customerId);
            return Promise.resolve({ count: initial - subscriptions.length });
          }),
        },
        refreshToken: {
          deleteMany: jest.fn(({ where }) => {
            const targetUsers = users.filter((u) => u.customerId === where.user.customerId).map((u) => u.id);
            const initial = refreshTokens.length;
            refreshTokens = refreshTokens.filter((rt) => !targetUsers.includes(rt.userId));
            return Promise.resolve({ count: initial - refreshTokens.length });
          }),
        },
        session: {
          deleteMany: jest.fn(({ where }) => {
            const targetUsers = users.filter((u) => u.customerId === where.user.customerId).map((u) => u.id);
            const initial = sessions.length;
            sessions = sessions.filter((s) => !targetUsers.includes(s.userId));
            return Promise.resolve({ count: initial - sessions.length });
          }),
        },
        user: {
          updateMany: jest.fn(({ where, data }) => {
            let count = 0;
            users.forEach((u) => {
              if (u.customerId === where.customerId) {
                Object.assign(u, data);
                count++;
              }
            });
            return Promise.resolve({ count });
          }),
        },
        customer: {
          update: jest.fn(({ where, data }) => {
            const idx = customers.findIndex((c) => c.id === where.id);
            if (idx !== -1) {
              customers[idx] = { ...customers[idx], ...data };
              return Promise.resolve(customers[idx]);
            }
            return Promise.resolve(null);
          }),
          delete: jest.fn(({ where }) => {
            const idx = customers.findIndex((c) => c.id === where.id);
            if (idx !== -1) {
              const removed = customers.splice(idx, 1)[0];
              return Promise.resolve(removed);
            }
            return Promise.resolve(null);
          }),
        },
      };

      return callback(tx);
    }),
  };

  beforeEach(async () => {
    // Reset test data
    customers = [
      { id: 101, name: 'Customer A', email: 'custA@example.com', isActive: true, deletedAt: null },
      { id: 202, name: 'Customer B', email: 'custB@example.com', isActive: true, deletedAt: null },
    ];

    invoices = [
      { id: 1, customerId: 101, invoiceNo: 'INV-A1', totalAmount: 5000 },
      { id: 2, customerId: 101, invoiceNo: 'INV-A2', totalAmount: 7000 },
      { id: 3, customerId: 202, invoiceNo: 'INV-B1', totalAmount: 12000 },
      { id: 4, customerId: 202, invoiceNo: 'INV-B2', totalAmount: 15000 },
    ];

    invoiceItems = [
      { id: 1, invoiceId: 1, total: 5000 },
      { id: 2, invoiceId: 2, total: 7000 },
      { id: 3, invoiceId: 3, total: 12000 },
      { id: 4, invoiceId: 4, total: 15000 },
    ];

    payments = [
      { id: 1, customerId: 101, amount: 5000, status: 'PAID' },
      { id: 2, customerId: 202, amount: 12000, status: 'PAID' },
    ];

    subscriptions = [
      { id: 1, customerId: 101, planId: 1, status: 'ACTIVE' },
      { id: 2, customerId: 202, planId: 2, status: 'ACTIVE' },
    ];

    installments = [
      { id: 1, customerId: 101, subscriptionId: 1, invoiceId: 1, paymentHistoryId: 1, amount: 5000 },
      { id: 2, customerId: 202, subscriptionId: 2, invoiceId: 3, paymentHistoryId: 2, amount: 12000 },
    ];

    customPlanOrders = [
      { id: 1, customerId: 101, orderNumber: 'CUST-ORD-A', totalAmount: 5000 },
      { id: 2, customerId: 202, orderNumber: 'CUST-ORD-B', totalAmount: 12000 },
    ];

    monthlySchedules = [
      { id: 1, customerId: 101, month: 9, year: 2026, status: 'PLANNED' },
      { id: 2, customerId: 202, month: 9, year: 2026, status: 'PLANNED' },
    ];

    users = [
      { id: 11, customerId: 101, email: 'userA@example.com', isActive: true, deletedAt: null },
      { id: 22, customerId: 202, email: 'userB@example.com', isActive: true, deletedAt: null },
    ];

    refreshTokens = [
      { id: 1, userId: 11, token: 'refresh-token-A' },
      { id: 2, userId: 22, token: 'refresh-token-B' },
    ];

    sessions = [
      { id: 1, userId: 11, token: 'session-A' },
      { id: 2, userId: 22, token: 'session-B' },
    ];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ScheduleService, useValue: {} },
        { provide: QBIdGenerator, useValue: { generateQBUserId: jest.fn() } },
        { provide: WorkService, useValue: {} },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
  });

  it('deletes Customer A invoices and billing while preserving Customer B completely', async () => {
    const superAdmin = { id: 1, role: 'SUPER_ADMIN' };

    // Delete Customer A
    const result = await service.remove(101, superAdmin);

    expect(result).toBeDefined();

    // 1. Verify Customer A is deactivated / marked deletedAt
    const custA = customers.find((c) => c.id === 101);
    expect(custA.isActive).toBe(false);
    expect(custA.deletedAt).toBeInstanceOf(Date);

    // 2. Verify Customer A invoices are DELETED
    const custAInvoices = invoices.filter((inv) => inv.customerId === 101);
    expect(custAInvoices).toHaveLength(0);

    // 3. Verify Customer A invoice items are DELETED
    expect(invoiceItems.filter((i) => i.invoiceId === 1 || i.invoiceId === 2)).toHaveLength(0);

    // 4. Verify Customer A payments are DELETED
    const custAPayments = payments.filter((p) => p.customerId === 101);
    expect(custAPayments).toHaveLength(0);

    // 5. Verify Customer A subscriptions, installments, custom orders, schedules are DELETED
    expect(subscriptions.filter((s) => s.customerId === 101)).toHaveLength(0);
    expect(installments.filter((i) => i.customerId === 101)).toHaveLength(0);
    expect(customPlanOrders.filter((o) => o.customerId === 101)).toHaveLength(0);
    expect(monthlySchedules.filter((s) => s.customerId === 101)).toHaveLength(0);

    // 6. Verify Customer A users are deactivated & sessions/tokens purged
    const userA = users.find((u) => u.id === 11);
    expect(userA.isActive).toBe(false);
    expect(userA.deletedAt).toBeInstanceOf(Date);
    expect(refreshTokens.find((r) => r.userId === 11)).toBeUndefined();
    expect(sessions.find((s) => s.userId === 11)).toBeUndefined();

    // 7. VERIFY CUSTOMER B REMAINS COMPLETELY INTACT AND UNTOUCHED
    const custB = customers.find((c) => c.id === 202);
    expect(custB).toBeDefined();
    expect(custB.isActive).toBe(true);
    expect(custB.deletedAt).toBeNull();

    const custBInvoices = invoices.filter((inv) => inv.customerId === 202);
    expect(custBInvoices).toHaveLength(2);
    expect(custBInvoices.map((i) => i.invoiceNo)).toEqual(['INV-B1', 'INV-B2']);

    const custBPayments = payments.filter((p) => p.customerId === 202);
    expect(custBPayments).toHaveLength(1);
    expect(custBPayments[0].amount).toBe(12000);

    const custBSubscriptions = subscriptions.filter((s) => s.customerId === 202);
    expect(custBSubscriptions).toHaveLength(1);

    const custBInstallments = installments.filter((i) => i.customerId === 202);
    expect(custBInstallments).toHaveLength(1);

    const custBOrders = customPlanOrders.filter((o) => o.customerId === 202);
    expect(custBOrders).toHaveLength(1);

    const custBSchedules = monthlySchedules.filter((s) => s.customerId === 202);
    expect(custBSchedules).toHaveLength(1);

    const userB = users.find((u) => u.id === 22);
    expect(userB.isActive).toBe(true);
    expect(userB.deletedAt).toBeNull();
    expect(refreshTokens.find((r) => r.userId === 22)).toBeDefined();
    expect(sessions.find((s) => s.userId === 22)).toBeDefined();
  });

  it('enforces tenant isolation: Tenant B admin cannot delete Customer A', async () => {
    const tenantBAdmin = { id: 22, customerId: 202, role: 'COMPANY_ADMIN' };

    await expect(service.remove(101, tenantBAdmin)).rejects.toThrow(ForbiddenException);

    // Verify nothing was deleted
    expect(customers.find((c) => c.id === 101).isActive).toBe(true);
    expect(invoices.filter((inv) => inv.customerId === 101)).toHaveLength(2);
  });

  it('throws NotFoundException if customer ID does not exist', async () => {
    const superAdmin = { id: 1, role: 'SUPER_ADMIN' };

    await expect(service.remove(999, superAdmin)).rejects.toThrow(NotFoundException);
  });

  it('supports hard-delete when hardDelete is true', async () => {
    const superAdmin = { id: 1, role: 'SUPER_ADMIN' };

    const result = await service.remove(101, superAdmin, true);

    expect(result).toBeDefined();
    expect(customers.find((c) => c.id === 101)).toBeUndefined();
    expect(invoices.filter((inv) => inv.customerId === 101)).toHaveLength(0);
    expect(payments.filter((p) => p.customerId === 101)).toHaveLength(0);

    // Customer B still intact
    expect(customers.find((c) => c.id === 202)).toBeDefined();
    expect(invoices.filter((inv) => inv.customerId === 202)).toHaveLength(2);
  });
});
