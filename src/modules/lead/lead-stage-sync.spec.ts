import { Test, TestingModule } from '@nestjs/testing';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';
import { LeadStatus } from '@prisma/client';
import { normalizeLeadStatus } from './dto/lead.dto';

import { PlanAccessService } from '../subscription/plan-access.service';

describe('Lead Stage / Status Synchronization Tests', () => {
  let controller: LeadController;
  let service: LeadService;
  let repository: LeadRepository;
  let prisma: any;

  // In-memory mock database
  let leadsTable: any[] = [];
  let statusHistoryTable: any[] = [];

  beforeEach(async () => {
    leadsTable = [
      {
        id: 101,
        customerId: 1,
        title: 'ABC Company',
        firstName: 'John',
        lastName: 'Doe',
        phone: '1234567890',
        status: LeadStatus.NEW,
        priority: 'MEDIUM',
        value: 50000,
        source: 'WEBSITE',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 102,
        customerId: 1,
        title: 'Lead B Enterprise',
        firstName: 'Jane',
        lastName: 'Smith',
        phone: '0987654321',
        status: LeadStatus.NEW,
        priority: 'HIGH',
        value: 80000,
        source: 'DIRECT',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 201,
        customerId: 2, // Belongs to Customer 2
        title: 'Customer 2 Secret Lead',
        firstName: 'Secret',
        lastName: 'Agent',
        phone: '5555555555',
        status: LeadStatus.NEW,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    statusHistoryTable = [];

    prisma = {
      lead: {
        findFirst: jest.fn(async ({ where }) => {
          return leadsTable.find((l) => {
            if (where.deletedAt === null && l.deletedAt !== null) return false;
            if (where.id !== undefined && l.id !== where.id) return false;
            if (where.customerId !== undefined && l.customerId !== where.customerId) return false;
            return true;
          }) || null;
        }),
        findMany: jest.fn(async ({ where }) => {
          return leadsTable.filter((l) => {
            if (where.deletedAt === null && l.deletedAt !== null) return false;
            if (where.customerId !== undefined && l.customerId !== where.customerId) return false;
            if (where.status !== undefined && l.status !== where.status) return false;
            return true;
          });
        }),
        count: jest.fn(async ({ where }) => {
          const items = leadsTable.filter((l) => {
            if (where.deletedAt === null && l.deletedAt !== null) return false;
            if (where.customerId !== undefined && l.customerId !== where.customerId) return false;
            if (where.status !== undefined && l.status !== where.status) return false;
            return true;
          });
          return items.length;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          let count = 0;
          for (const l of leadsTable) {
            if (where.id !== undefined && l.id !== where.id) continue;
            if (where.customerId !== undefined && l.customerId !== where.customerId) continue;
            Object.assign(l, data);
            count++;
          }
          return { count };
        }),
      },
      leadStatusHistory: {
        create: jest.fn(async ({ data }) => {
          const entry = { id: statusHistoryTable.length + 1, ...data, createdAt: new Date() };
          statusHistoryTable.push(entry);
          return entry;
        }),
      },
      leadActivityTimeline: {
        create: jest.fn(async ({ data }) => ({ id: 1, ...data })),
      },
      customer: {
        findFirst: jest.fn(async ({ where }) => {
          if (where.id === 1) return { id: 1, name: 'Customer 1', isActive: true, deletedAt: null };
          if (where.id === 2) return { id: 2, name: 'Customer 2', isActive: true, deletedAt: null };
          return null;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeadController],
      providers: [
        LeadService,
        LeadRepository,
        { provide: PrismaService, useValue: prisma },
        { provide: LeadLimitService, useValue: {} },
        { provide: PlanAccessService, useValue: { checkLeadLimit: jest.fn() } },
      ],
    }).compile();

    controller = module.get<LeadController>(LeadController);
    service = module.get<LeadService>(LeadService);
    repository = module.get<LeadRepository>(LeadRepository);
  });

  describe('1. Dynamic Stage Status Transitions & History Audit', () => {
    it('Admin updates ABC Company: NEW -> CONTACTED -> FOLLOW_UP -> QUALIFIED -> CONVERTED', async () => {
      // 1. Initial State
      const initial = await service.getLeadById(1, 101);
      expect(initial.status).toBe(LeadStatus.NEW);

      // 2. Admin changes NEW -> CONTACTED
      const step1 = await service.updateStatus(1, 101, 999, { status: LeadStatus.CONTACTED });
      expect(step1.status).toBe(LeadStatus.CONTACTED);

      // 3. Admin changes CONTACTED -> FOLLOW_UP
      const step2 = await service.updateStatus(1, 101, 999, { status: LeadStatus.FOLLOW_UP });
      expect(step2.status).toBe(LeadStatus.FOLLOW_UP);

      // 4. Admin changes FOLLOW_UP -> QUALIFIED
      const step3 = await service.updateStatus(1, 101, 999, { status: LeadStatus.QUALIFIED });
      expect(step3.status).toBe(LeadStatus.QUALIFIED);

      // 5. Admin changes QUALIFIED -> CONVERTED
      const step4 = await service.updateStatus(1, 101, 999, { status: LeadStatus.CONVERTED });
      expect(step4.status).toBe(LeadStatus.CONVERTED);

      // Verify audit history was recorded in database for each transition
      expect(statusHistoryTable).toHaveLength(4);
      expect(statusHistoryTable[0].fromStatus).toBe(LeadStatus.NEW);
      expect(statusHistoryTable[0].toStatus).toBe(LeadStatus.CONTACTED);
      expect(statusHistoryTable[3].toStatus).toBe(LeadStatus.CONVERTED);
    });

    it('Maintains independent stages between Lead A and Lead B', async () => {
      // Lead A is moved to CONVERTED
      await service.updateStatus(1, 101, 999, { status: LeadStatus.CONVERTED });

      // Lead B is moved to LOST
      await service.updateStatus(1, 102, 999, { status: LeadStatus.LOST });

      const leadA = await service.getLeadById(1, 101);
      const leadB = await service.getLeadById(1, 102);

      expect(leadA.status).toBe(LeadStatus.CONVERTED);
      expect(leadB.status).toBe(LeadStatus.LOST);
    });
  });

  describe('2. Multi-Tenant Customer Data Isolation', () => {
    it('Customer 1 cannot view Customer 2 leads', async () => {
      const cust1Leads = await service.getLeads(1, {}, { customerId: 1, role: 'CUSTOMER' });
      expect(cust1Leads.data.every((l: any) => l.customerId === 1)).toBe(true);
      expect(cust1Leads.data.some((l: any) => l.id === 201)).toBe(false);
    });

    it('Customer 1 cannot access or update Customer 2 lead by ID', async () => {
      await expect(service.getLeadById(1, 201)).rejects.toThrow('Lead with ID 201 not found');

      await expect(
        service.updateStatus(1, 201, 999, { status: LeadStatus.QUALIFIED }),
      ).rejects.toThrow('Lead with ID 201 not found');

      // Verify Lead 201 in DB was NOT touched
      const lead201 = leadsTable.find((l) => l.id === 201);
      expect(lead201.status).toBe(LeadStatus.NEW);
    });
  });

  describe('3. Status Input Normalization Helper', () => {
    it('Normalizes user and admin inputs correctly to LeadStatus enum', () => {
      expect(normalizeLeadStatus('New')).toBe(LeadStatus.NEW);
      expect(normalizeLeadStatus('Contacted')).toBe(LeadStatus.CONTACTED);
      expect(normalizeLeadStatus('Follow Up')).toBe(LeadStatus.FOLLOW_UP);
      expect(normalizeLeadStatus('follow-up')).toBe(LeadStatus.FOLLOW_UP);
      expect(normalizeLeadStatus('Qualified')).toBe(LeadStatus.QUALIFIED);
      expect(normalizeLeadStatus('Converted')).toBe(LeadStatus.CONVERTED);
      expect(normalizeLeadStatus('Won')).toBe(LeadStatus.WON);
      expect(normalizeLeadStatus('Lost')).toBe(LeadStatus.LOST);
    });
  });

  describe('4. GET /leads/stages Endpoint', () => {
    it('Returns list of configured stages with sortOrder, labels, and colors', async () => {
      const stages = await controller.getStages();
      expect(Array.isArray(stages)).toBe(true);
      expect(stages.length).toBeGreaterThanOrEqual(10);

      const newStage = stages.find((s) => s.key === 'NEW');
      expect(newStage).toBeDefined();
      expect(newStage?.label).toBe('New');
      expect(newStage?.sortOrder).toBe(0);
      expect(newStage?.color).toBe('#0284C7');

      const convertedStage = stages.find((s) => s.key === 'CONVERTED');
      expect(convertedStage).toBeDefined();
      expect(convertedStage?.label).toBe('Converted');
      expect(convertedStage?.color).toBe('#16A34A');
    });
  });
});
