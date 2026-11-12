import { CustomerService, customerOriginIsWon, leadStageIsWon } from './customer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';
import { Test } from '@nestjs/testing';

describe('Customers are visible only for WON leads', () => {
  const employee = {
    id: 201,
    role: 'EMPLOYEE',
    employeeId: 1,
    customerId: 10,
    employee: { id: 1, customerId: 10 },
  };

  it('recognizes only the WON pipeline stage', () => {
    expect(leadStageIsWon({ status: 'NEW', stage: { key: 'NEW', name: 'New' } })).toBe(false);
    expect(leadStageIsWon({ status: 'CONTACTED', stage: { key: 'CONTACTED', name: 'Contacted' } })).toBe(false);
    expect(leadStageIsWon({ status: 'LOST', stage: { key: 'LOST', name: 'Lost' } })).toBe(false);
    expect(leadStageIsWon({ status: 'WON', stage: { key: 'WON', name: 'Won' } })).toBe(true);
    expect(customerOriginIsWon({ originLead: { status: 'LOST', stage: { key: 'LOST', name: 'Lost' } } })).toBe(false);
    expect(customerOriginIsWon({ leads: [{ status: 'WON', stage: { key: 'WON', name: 'Won' } }] })).toBe(true);
  });

  it('hides a New lead and shows a WON customer to an employee', async () => {
    const wonCustomer = {
      id: 9,
      name: 'Valaji Boutique',
      companyName: 'Valaji Boutique',
      isActive: true,
      assignedEmployeeId: 1,
      subscriptions: [],
      works: [],
      tasks: [],
      leads: [{ id: 1009, status: 'WON', stage: { key: 'WON', name: 'Won' }, reminders: [] }],
      users: [],
      commissions: [],
      _count: { users: 1, leads: 1, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };
    const newLead = {
      id: 50,
      companyName: 'New Shop',
      status: 'NEW',
      stage: { key: 'NEW', name: 'New' },
      employeeId: 1,
      reminders: [],
    };
    const prisma: any = {
      customer: { findMany: jest.fn().mockResolvedValue([wonCustomer]) },
      lead: { findMany: jest.fn().mockResolvedValue([newLead]) },
      leadStage: { findMany: jest.fn().mockResolvedValue([{ id: 1, key: 'WON', name: 'Won' }]) },
      employee: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScheduleService, useValue: {} },
        { provide: QBIdGenerator, useValue: { generateQbId: () => 'QB-1' } },
        { provide: WorkService, useValue: {} },
      ],
    }).compile();
    const service = moduleRef.get(CustomerService);
    const res = await service.findAll({ status: 'ALL', search: 'Valaji' }, employee);
    expect(res.items.map((item) => item.companyName || item.name)).toContain('Valaji Boutique');
    expect(res.items.some((item) => item.companyName === 'New Shop' || item.name === 'New Shop')).toBe(false);
  });

  it('hides a Final Call customer and still lists a tenant with no lead for a super admin', async () => {
    const tenant = { id: 1, name: 'Tenant Co', companyName: 'Tenant Co', isActive: true, subscriptions: [], works: [], tasks: [], leads: [], users: [], commissions: [], _count: {} };
    const finalCallCustomer = {
      id: 2,
      name: 'Final Call Shop',
      companyName: 'Final Call Shop',
      isActive: false,
      subscriptions: [],
      works: [],
      tasks: [],
      leads: [{ id: 70, status: 'FINAL_CALL', stage: { key: 'FINAL_CALL', name: 'Final Call' }, reminders: [] }],
      users: [],
      commissions: [],
      _count: {},
    };
    const prisma: any = {
      customer: { findMany: jest.fn().mockResolvedValue([tenant, finalCallCustomer]) },
      lead: { findMany: jest.fn().mockResolvedValue([{ id: 80, companyName: 'Still Final', status: 'FINAL_CALL', stage: { key: 'FINAL_CALL', name: 'Final Call' }, reminders: [] }]) },
      leadStage: { findMany: jest.fn().mockResolvedValue([{ id: 9, key: 'WON', name: 'Won' }]) },
      employee: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScheduleService, useValue: {} },
        { provide: QBIdGenerator, useValue: { generateQbId: () => 'QB-1' } },
        { provide: WorkService, useValue: {} },
      ],
    }).compile();
    const service = moduleRef.get(CustomerService);
    const res = await service.findAll({ status: 'ALL' }, { id: 1, role: 'SUPER_ADMIN', roles: ['SUPER_ADMIN'] });
    expect(res.items.map((item) => item.companyName)).toContain('Tenant Co');
    expect(res.items.map((item) => item.companyName)).not.toContain('Final Call Shop');
    expect(res.items.map((item) => item.companyName)).toContain('Still Final');
    expect(res.items.find((item) => item.companyName === 'Still Final')?.customerStatus).toBe('UPCOMING');
  });
});
