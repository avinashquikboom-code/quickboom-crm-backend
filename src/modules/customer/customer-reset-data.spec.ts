import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('Customer-Wise Data Reset (Customer-Scoped & Isolated)', () => {
  let service: CustomerService;

  // Mock in-memory tables
  let customers: any[] = [];
  let leads: any[] = [];
  let contacts: any[] = [];
  let companies: any[] = [];
  let deals: any[] = [];
  let tasks: any[] = [];
  let visits: any[] = [];
  let quotations: any[] = [];
  let invoices: any[] = [];
  let invoiceItems: any[] = [];
  let payments: any[] = [];
  let auditLogs: any[] = [];

  const mockPrismaService: any = {
    customer: {
      findUnique: jest.fn(({ where, select }) => {
        const found = customers.find((c) => c.id === where.id);
        if (!found) return Promise.resolve(null);
        if (select) {
          const res: any = {};
          for (const k of Object.keys(select)) {
            if (select[k]) res[k] = found[k];
          }
          return Promise.resolve(res);
        }
        return Promise.resolve(found);
      }),
      update: jest.fn(({ where, data }) => {
        const idx = customers.findIndex((c) => c.id === where.id);
        if (idx !== -1) {
          customers[idx] = { ...customers[idx], ...data };
          return Promise.resolve(customers[idx]);
        }
        return Promise.resolve(null);
      }),
    },
    lead: {
      count: jest.fn(({ where }) => Promise.resolve(leads.filter((l) => l.customerId === where.customerId).length)),
    },
    contact: {
      count: jest.fn(({ where }) => Promise.resolve(contacts.filter((c) => c.customerId === where.customerId).length)),
    },
    company: {
      count: jest.fn(({ where }) => Promise.resolve(companies.filter((c) => c.customerId === where.customerId).length)),
    },
    deal: {
      count: jest.fn(({ where }) => Promise.resolve(deals.filter((d) => d.customerId === where.customerId).length)),
    },
    task: {
      count: jest.fn(({ where }) => Promise.resolve(tasks.filter((t) => t.customerId === where.customerId).length)),
    },
    visit: {
      count: jest.fn(({ where }) => Promise.resolve(visits.filter((v) => v.customerId === where.customerId).length)),
    },
    quotation: {
      count: jest.fn(({ where }) => Promise.resolve(quotations.filter((q) => q.customerId === where.customerId).length)),
    },
    invoice: {
      count: jest.fn(({ where }) => Promise.resolve(invoices.filter((i) => i.customerId === where.customerId).length)),
    },
    paymentHistory: {
      count: jest.fn(({ where }) => Promise.resolve(payments.filter((p) => p.customerId === where.customerId).length)),
    },
    subscriptionInstallment: { count: jest.fn(() => Promise.resolve(0)) },
    dataCapturePlace: { count: jest.fn(() => Promise.resolve(0)) },
    dataCaptureJob: { count: jest.fn(() => Promise.resolve(0)) },
    work: { count: jest.fn(() => Promise.resolve(0)) },
    supportTicket: { count: jest.fn(() => Promise.resolve(0)) },
    notification: { count: jest.fn(() => Promise.resolve(0)) },
    attendance: { count: jest.fn(() => Promise.resolve(0)) },
    attendanceBreak: { count: jest.fn(() => Promise.resolve(0)) },
    leaveRequest: { count: jest.fn(() => Promise.resolve(0)) },
    remoteRequest: { count: jest.fn(() => Promise.resolve(0)) },
    employeeLocation: { count: jest.fn(() => Promise.resolve(0)) },
    payroll: { count: jest.fn(() => Promise.resolve(0)) },
    salarySlip: { count: jest.fn(() => Promise.resolve(0)) },
    employee: { count: jest.fn(() => Promise.resolve(2)) },
    department: { count: jest.fn(() => Promise.resolve(1)) },
    designation: { count: jest.fn(() => Promise.resolve(1)) },
    user: { count: jest.fn(() => Promise.resolve(2)) },
    customerSubscription: { count: jest.fn(() => Promise.resolve(1)) },

    $transaction: jest.fn(async (callback: any) => {
      const tx = {
        leadActivityTimeline: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        leadNote: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        leadReminder: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        leadStatusHistory: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        communicationHistory: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        taskReview: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        taskProof: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        taskHistory: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        quotationItem: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        workTask: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        ticketComment: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        attendanceBreak: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },

        invoiceItem: {
          deleteMany: jest.fn(({ where }) => {
            const customerInvoices = invoices.filter((inv) => inv.customerId === where.invoice.customerId).map((i) => i.id);
            const initial = invoiceItems.length;
            invoiceItems = invoiceItems.filter((it) => !customerInvoices.includes(it.invoiceId));
            return Promise.resolve({ count: initial - invoiceItems.length });
          }),
        },
        invoice: {
          deleteMany: jest.fn(({ where }) => {
            const initial = invoices.length;
            invoices = invoices.filter((i) => i.customerId !== where.customerId);
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
        subscriptionInstallment: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        customPlanOrder: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        monthlySchedule: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        quotation: {
          deleteMany: jest.fn(({ where }) => {
            const initial = quotations.length;
            quotations = quotations.filter((q) => q.customerId !== where.customerId);
            return Promise.resolve({ count: initial - quotations.length });
          }),
        },
        task: {
          deleteMany: jest.fn(({ where }) => {
            const initial = tasks.length;
            tasks = tasks.filter((t) => t.customerId !== where.customerId);
            return Promise.resolve({ count: initial - tasks.length });
          }),
        },
        deal: {
          deleteMany: jest.fn(({ where }) => {
            const initial = deals.length;
            deals = deals.filter((d) => d.customerId !== where.customerId);
            return Promise.resolve({ count: initial - deals.length });
          }),
        },
        visit: {
          deleteMany: jest.fn(({ where }) => {
            const initial = visits.length;
            visits = visits.filter((v) => v.customerId !== where.customerId);
            return Promise.resolve({ count: initial - visits.length });
          }),
        },
        lead: {
          deleteMany: jest.fn(({ where }) => {
            const initial = leads.length;
            leads = leads.filter((l) => l.customerId !== where.customerId);
            return Promise.resolve({ count: initial - leads.length });
          }),
        },
        contact: {
          deleteMany: jest.fn(({ where }) => {
            const initial = contacts.length;
            contacts = contacts.filter((c) => c.customerId !== where.customerId);
            return Promise.resolve({ count: initial - contacts.length });
          }),
        },
        company: {
          deleteMany: jest.fn(({ where }) => {
            const initial = companies.length;
            companies = companies.filter((c) => c.customerId !== where.customerId);
            return Promise.resolve({ count: initial - companies.length });
          }),
        },
        dataCapturePlace: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        dataCaptureJob: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        work: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        supportTicket: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        notification: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        employeeLocation: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        attendance: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        leaveRequest: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        remoteRequest: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        salarySlip: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        payrollItem: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        payroll: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        employeeClaim: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        employeeLoan: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        customerSubscription: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
        customer: {
          update: jest.fn(({ where, data }) => {
            const idx = customers.findIndex((c) => c.id === where.id);
            if (idx !== -1) {
              customers[idx] = { ...customers[idx], ...data };
              return Promise.resolve(customers[idx]);
            }
            return Promise.resolve(null);
          }),
        },
        auditLog: {
          create: jest.fn(({ data }) => {
            auditLogs.push(data);
            return Promise.resolve(data);
          }),
        },
      };
      return callback(tx);
    }),
  };

  beforeEach(async () => {
    customers = [
      { id: 101, name: 'Acme Corp', companyName: 'Acme Industries', isActive: true, storageUsed: 5000 },
      { id: 102, name: 'Beta Ltd', companyName: 'Beta Fitness', isActive: true, storageUsed: 3000 },
    ];
    leads = [
      { id: 1, customerId: 101, name: 'Lead 1 (Acme)' },
      { id: 2, customerId: 101, name: 'Lead 2 (Acme)' },
      { id: 3, customerId: 102, name: 'Lead 3 (Beta)' },
    ];
    contacts = [
      { id: 1, customerId: 101, name: 'Contact 1' },
      { id: 2, customerId: 102, name: 'Contact 2' },
    ];
    companies = [
      { id: 1, customerId: 101, name: 'Acme Sub' },
      { id: 2, customerId: 102, name: 'Beta Sub' },
    ];
    deals = [
      { id: 1, customerId: 101, title: 'Acme Deal' },
      { id: 2, customerId: 102, title: 'Beta Deal' },
    ];
    tasks = [
      { id: 1, customerId: 101, title: 'Acme Task' },
      { id: 2, customerId: 102, title: 'Beta Task' },
    ];
    visits = [
      { id: 1, customerId: 101, title: 'Acme Visit' },
      { id: 2, customerId: 102, title: 'Beta Visit' },
    ];
    invoices = [
      { id: 1, customerId: 101, invoiceNo: 'INV-101' },
      { id: 2, customerId: 102, invoiceNo: 'INV-102' },
    ];
    invoiceItems = [
      { id: 1, invoiceId: 1, name: 'Item 1' },
      { id: 2, invoiceId: 2, name: 'Item 2' },
    ];
    payments = [
      { id: 1, customerId: 101, amount: 1500 },
      { id: 2, customerId: 102, amount: 2500 },
    ];
    auditLogs = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ScheduleService, useValue: {} },
        { provide: QBIdGenerator, useValue: {} },
        { provide: WorkService, useValue: {} },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
  });

  it('1. Fetches live reset summary for Customer A with accurate counts', async () => {
    const summary = await service.getResetSummary(101, { role: 'SUPER_ADMIN' });
    expect(summary.customer.id).toBe(101);
    expect(summary.customer.name).toBe('Acme Corp');
    expect(summary.summary.crm.leads).toBe(2);
    expect(summary.summary.crm.contacts).toBe(1);
    expect(summary.summary.crm.deals).toBe(1);
    expect(summary.summary.crm.tasks).toBe(1);
    expect(summary.summary.crm.visits).toBe(1);
    expect(summary.summary.billing.invoices).toBe(1);
    expect(summary.summary.billing.payments).toBe(1);
    expect(summary.masterDataPreserved.accountRemains).toBe(true);
  });

  it('2. Enforces name confirmation: fails if confirmation string does not match customer name', async () => {
    await expect(
      service.resetCustomerData(
        101,
        { role: 'SUPER_ADMIN' },
        { confirmation: 'Wrong Name' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('3. Enforces cross-tenant isolation: Tenant B admin CANNOT reset Customer A (403 Forbidden)', async () => {
    const tenantBAdmin = {
      id: 55,
      role: 'ADMIN',
      customerId: 102, // Tenant B
    };

    await expect(
      service.resetCustomerData(
        101, // Trying to reset Customer A
        tenantBAdmin,
        { confirmation: 'Acme Corp' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('4. Resets Customer A business data completely while Customer B remains 100% UNTOUCHED', async () => {
    const superAdmin = { id: 1, role: 'SUPER_ADMIN', email: 'admin@qbapp.online' };

    const result = await service.resetCustomerData(
      101,
      superAdmin,
      { confirmation: 'Acme Corp' },
    );

    expect(result.success).toBe(true);
    expect(result.totalDeleted).toBeGreaterThan(0);

    // Verify Customer A records in memory are wiped
    expect(leads.filter((l) => l.customerId === 101)).toHaveLength(0);
    expect(contacts.filter((c) => c.customerId === 101)).toHaveLength(0);
    expect(companies.filter((c) => c.customerId === 101)).toHaveLength(0);
    expect(deals.filter((d) => d.customerId === 101)).toHaveLength(0);
    expect(tasks.filter((t) => t.customerId === 101)).toHaveLength(0);
    expect(visits.filter((v) => v.customerId === 101)).toHaveLength(0);
    expect(invoices.filter((i) => i.customerId === 101)).toHaveLength(0);
    expect(payments.filter((p) => p.customerId === 101)).toHaveLength(0);

    // Verify Customer A account still exists and storage is reset
    const customerA = customers.find((c) => c.id === 101);
    expect(customerA).toBeDefined();
    expect(customerA.isActive).toBe(true);
    expect(customerA.storageUsed).toBe(0);

    // CRITICAL: Verify Customer B records are 100% UNTOUCHED
    expect(leads.filter((l) => l.customerId === 102)).toHaveLength(1);
    expect(contacts.filter((c) => c.customerId === 102)).toHaveLength(1);
    expect(companies.filter((c) => c.customerId === 102)).toHaveLength(1);
    expect(deals.filter((d) => d.customerId === 102)).toHaveLength(1);
    expect(tasks.filter((t) => t.customerId === 102)).toHaveLength(1);
    expect(visits.filter((v) => v.customerId === 102)).toHaveLength(1);
    expect(invoices.filter((i) => i.customerId === 102)).toHaveLength(1);
    expect(payments.filter((p) => p.customerId === 102)).toHaveLength(1);

    // Verify AuditLog entry was written
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].customerId).toBe(101);
    expect(auditLogs[0].action).toBe('CUSTOMER_DATA_RESET');
    expect(auditLogs[0].details.totalDeleted).toBe(result.totalDeleted);
  });
});
