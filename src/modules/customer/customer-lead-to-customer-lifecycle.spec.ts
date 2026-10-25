import { CustomerService } from './customer.service';
import { convertWonLead, recalculateCustomer } from './customer-lifecycle.util';

describe('CRM Lead-to-Customer Lifecycle', () => {
  const adminUser = { id: 1, accountType: 'ADMIN' };
  const employeeUser = { id: 10, accountType: 'EMPLOYEE' };
  const otherEmployeeUser = { id: 20, accountType: 'EMPLOYEE' };

  it('1. Move a lead to Final Call: it appears under Upcoming with business details', async () => {
    const finalCallLead = {
      id: 101,
      companyName: 'Acme Corp',
      firstName: 'John',
      lastName: 'Doe',
      phone: '+919876543210',
      email: 'john@acme.com',
      status: 'FINAL_CALL',
      assignedToId: 5,
      assignedTo: {
        id: 5,
        firstName: 'Sarah',
        lastName: 'Connor',
        employeeCode: 'EMP005',
      },
      createdAt: new Date('2026-10-01T10:00:00Z'),
      updatedAt: new Date('2026-10-25T11:00:00Z'),
      customer: null,
    };

    const prisma: any = {
      employee: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([finalCallLead]),
      },
      customer: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const service = new CustomerService(prisma);
    const result = await service.list(adminUser, '', 'UPCOMING');

    expect(result.counts.upcoming).toBe(1);
    expect(result.counts.inactive).toBe(0);
    expect(result.counts.active).toBe(0);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe('UPCOMING');
    expect(result.data[0].companyName).toBe('Acme Corp');
    expect(result.data[0].phone).toBe('+919876543210');
    expect(result.data[0].assignedEmployee).toBe('Sarah Connor');
    expect(result.data[0].hasUpcomingCall).toBe(true);
    expect(result.data[0].upcomingCallType).toBe('Final Call');
  });

  it('2. Move that lead to Won: it appears under Inactive and leaves Upcoming without activating subscription', async () => {
    const leadWon = {
      id: 101,
      status: 'WON',
      companyName: 'Acme Corp',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@acme.com',
      phone: '+919876543210',
    };

    let savedCustomer: any = null;
    const tx: any = {
      customer: {
        upsert: jest.fn().mockImplementation(async ({ create }) => {
          savedCustomer = { id: 501, ...create, userId: null };
          return savedCustomer;
        }),
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 99 }),
      },
    };

    // 1) convertWonLead creates Inactive Customer
    await convertWonLead(tx, leadWon);
    expect(savedCustomer.status).toBe('INACTIVE');
    expect(savedCustomer.originLeadId).toBe(101);

    // 2) Listing from service: lead is now WON so it is not in upcoming
    const prisma: any = {
      employee: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([]), // No leads in FINAL_CALL
        findUnique: jest.fn().mockResolvedValue({
          id: 101,
          status: 'WON',
          assignedTo: { firstName: 'Sarah', lastName: 'Connor' },
        }),
      },
      customer: {
        findMany: jest.fn().mockResolvedValue([savedCustomer]),
      },
      $transaction: jest.fn(async (cb) => {
        return cb({
          $queryRaw: jest.fn().mockResolvedValue([]),
          customerSubscription: {
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn(),
            count: jest.fn().mockResolvedValue(0),
          },
          customer: {
            update: jest.fn().mockResolvedValue({ ...savedCustomer, status: 'INACTIVE' }),
          },
          lead: {
            findUnique: jest.fn().mockResolvedValue({
              id: 101,
              status: 'WON',
              assignedTo: { firstName: 'Sarah', lastName: 'Connor' },
            }),
          },
          team: { findUnique: jest.fn() },
          company: { findUnique: jest.fn() },
        });
      }),
    };

    const service = new CustomerService(prisma);
    const result = await service.list(adminUser, '', 'INACTIVE');

    expect(result.counts.upcoming).toBe(0);
    expect(result.counts.inactive).toBe(1);
    expect(result.counts.active).toBe(0);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe('INACTIVE');
    expect(result.data[0].companyName).toBe('Acme Corp');
    expect(result.data[0].planName).toBeUndefined();
  });

  it('3. Verify no duplicate customer is created on repeated conversions or stage updates', async () => {
    const leadWon = {
      id: 101,
      status: 'WON',
      companyName: 'Acme Corp',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@acme.com',
      phone: '+919876543210',
    };

    let upsertCount = 0;
    const tx: any = {
      customer: {
        upsert: jest.fn().mockImplementation(async () => {
          upsertCount++;
          return { id: 501, originLeadId: 101, userId: 99, status: 'INACTIVE' };
        }),
      },
    };

    await convertWonLead(tx, leadWon);
    await convertWonLead(tx, leadWon);
    await convertWonLead(tx, leadWon);

    // Upsert uses unique originLeadId so multiple updates don't create multiple customers
    expect(upsertCount).toBe(3);
    expect(tx.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { originLeadId: 101 },
      }),
    );
  });

  it('4. Purchase and activate a plan successfully: customer appears under Active', async () => {
    const now = new Date();
    const pastStart = new Date(now.getTime() - 3600000);
    const futureEnd = new Date(now.getTime() + 30 * 86400000);

    const activeSubscription = {
      id: 701,
      customerId: 501,
      planId: 1,
      status: 'ACTIVE',
      startDate: pastStart,
      endDate: futureEnd,
      activationDate: pastStart,
      plan: { name: 'Growth Pro' },
      checkout: { status: 'PAID' },
      createdAt: pastStart,
    };

    const customerRecord = {
      id: 501,
      originLeadId: 101,
      companyName: 'Acme Corp',
      status: 'ACTIVE',
      deletedAt: null,
    };

    const prisma: any = {
      employee: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          id: 101,
          status: 'WON',
          assignedTo: { firstName: 'Sarah', lastName: 'Connor' },
        }),
      },
      customer: {
        findMany: jest.fn().mockResolvedValue([customerRecord]),
      },
      $transaction: jest.fn(async (cb) => {
        return cb({
          $queryRaw: jest.fn().mockResolvedValue([]),
          customerSubscription: {
            findMany: jest.fn().mockResolvedValue([activeSubscription]),
            updateMany: jest.fn(),
            count: jest.fn().mockResolvedValue(1),
          },
          customer: {
            update: jest.fn().mockResolvedValue({ ...customerRecord, status: 'ACTIVE' }),
          },
          lead: {
            findUnique: jest.fn().mockResolvedValue({
              id: 101,
              status: 'WON',
              assignedTo: { firstName: 'Sarah', lastName: 'Connor' },
            }),
          },
          team: { findUnique: jest.fn() },
          company: { findUnique: jest.fn() },
        });
      }),
    };

    const service = new CustomerService(prisma);
    const result = await service.list(adminUser, '', 'ACTIVE');

    expect(result.counts.active).toBe(1);
    expect(result.counts.inactive).toBe(0);
    expect(result.counts.upcoming).toBe(0);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe('ACTIVE');
    expect(result.data[0].planName).toBe('Growth Pro');
    expect(result.data[0].subscriptionStatus).toBe('ACTIVE');
  });

  it('5. Simulate a failed or unpaid checkout: customer remains Inactive', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      customerSubscription: {
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0), // No paid active subscription
      },
      customer: {
        update: jest.fn().mockResolvedValue({ id: 501, status: 'INACTIVE' }),
      },
    };

    const customer = await recalculateCustomer(tx, 501);
    expect(customer.status).toBe('INACTIVE');
    expect(tx.customerSubscription.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: 501,
          status: 'ACTIVE',
          checkout: { status: 'PAID' },
        }),
      }),
    );
  });

  it('6. Expire a plan: applies expiry rules and marks customer Inactive', async () => {
    const now = new Date();
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      customerSubscription: {
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0), // All expired -> count 0
      },
      customer: {
        update: jest.fn().mockResolvedValue({ id: 501, status: 'INACTIVE' }),
      },
    };

    const customer = await recalculateCustomer(tx, 501, now);
    expect(tx.customerSubscription.updateMany).toHaveBeenCalledWith({
      where: { customerId: 501, status: 'ACTIVE', endDate: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    expect(customer.status).toBe('INACTIVE');
  });

  it('7. Employee access restrictions: BPO employee only sees their assigned leads/customers', async () => {
    const assignedLead = {
      id: 101,
      companyName: 'Assigned Lead',
      status: 'FINAL_CALL',
      assignedToId: 5,
      assignedTo: { id: 5, firstName: 'BPO', lastName: 'User' },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const prisma: any = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 5,
          status: 'ACTIVE',
          mobileLoginEnabled: true,
        }),
      },
      lead: {
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          // Employee scope verification: assignedToId == 5
          const hasEmployeeScope = JSON.stringify(where).includes('"assignedToId":5');
          return hasEmployeeScope ? [assignedLead] : [];
        }),
      },
      customer: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const service = new CustomerService(prisma);
    const result = await service.list(employeeUser, '', 'UPCOMING');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].companyName).toBe('Assigned Lead');
    expect(prisma.lead.findMany).toHaveBeenCalled();
  });
});
