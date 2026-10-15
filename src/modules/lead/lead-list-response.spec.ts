import { LeadRepository } from './lead.repository';

describe('Lead List API Response Contract', () => {
  let mockPrisma: any;
  let repository: LeadRepository;

  beforeEach(() => {
    mockPrisma = {
      lead: {
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      dataCapturePlace: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      visit: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    repository = new LeadRepository(mockPrisma);
  });

  it('omits assignedToId, assignedEmployee, and assignedToName from Lead list response while preserving other fields', async () => {
    const rawLead = {
      id: 42,
      customerId: 1,
      title: 'Acme Corp Lead',
      companyName: 'Acme Corp',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@acme.com',
      phone: '+919876543210',
      status: 'NEW',
      stageId: 10,
      stage: { id: 10, name: 'New Lead', key: 'NEW' },
      assignedToId: 13,
      assignedEmployee: 'Bhavesh Gandhi',
      assignedTo: { id: 13, firstName: 'Bhavesh', lastName: 'Gandhi', email: 'bhavesh@crm.com' },
      createdById: 1,
      createdBy: { id: 1, firstName: 'Admin', lastName: 'User' },
      createdAt: new Date('2026-10-01'),
      updatedAt: new Date('2026-10-01'),
    };

    mockPrisma.lead.findMany.mockResolvedValue([rawLead]);
    mockPrisma.lead.count.mockResolvedValue(1);

    const result = await repository.findAll(1, { page: 1, limit: 10 }, { id: 1, role: 'ADMIN', customerId: 1 });

    expect(result.data).toHaveLength(1);
    const item = result.data[0];

    // Confirm the three incorrect fields are absent from response
    expect(item.assignedToId).toBeUndefined();
    expect(item.assignedEmployee).toBeUndefined();
    expect(item.assignedToName).toBeUndefined();
    expect('assignedToId' in item).toBe(false);
    expect('assignedEmployee' in item).toBe(false);
    expect('assignedToName' in item).toBe(false);

    // Confirm other required fields are intact
    expect(item.id).toBe(42);
    expect(item.companyName).toBe('Acme Corp');
    expect(item.firstName).toBe('John');
    expect(item.lastName).toBe('Doe');
    expect(item.email).toBe('john@acme.com');
    expect(item.phone).toBe('+919876543210');
    expect(item.status).toBe('NEW');
    expect(item.stageId).toBe(10);
    expect(item.stage).toEqual({ id: 10, name: 'New Lead', key: 'NEW' });
    expect(result.meta.total).toBe(1);

    // Confirm underlying raw database object assignment was not altered
    expect(rawLead.assignedToId).toBe(13);
  });
});
