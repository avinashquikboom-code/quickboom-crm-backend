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
  let stagesTable: any[] = [];

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
    stagesTable = [
      { id: 1, customerId: null, name: 'New', key: 'NEW', color: '#0284C7', bgColor: '#E0F2FE', borderColor: '#BAE6FD', sortOrder: 0, isActive: true, isSystem: true, deletedAt: null },
      { id: 2, customerId: null, name: 'Contacted', key: 'CONTACTED', color: '#D97706', bgColor: '#FEF3C7', borderColor: '#FDE68A', sortOrder: 1, isActive: true, isSystem: true, deletedAt: null },
      { id: 3, customerId: null, name: 'Follow-up', key: 'FOLLOW_UP', color: '#D97706', bgColor: '#FEF3C7', borderColor: '#FDE68A', sortOrder: 2, isActive: true, isSystem: true, deletedAt: null },
      { id: 4, customerId: null, name: 'Visit Scheduled', key: 'VISIT', color: '#8B5CF6', bgColor: '#F3E8FF', borderColor: '#E9D5FF', sortOrder: 3, isActive: true, isSystem: true, deletedAt: null },
      { id: 5, customerId: null, name: 'Qualified', key: 'QUALIFIED', color: '#4F46E5', bgColor: '#EEF2FF', borderColor: '#E0E7FF', sortOrder: 4, isActive: true, isSystem: true, deletedAt: null },
      { id: 6, customerId: null, name: 'Proposal', key: 'PROPOSAL', color: '#06B6D4', bgColor: '#CFFAFE', borderColor: '#A5F3FC', sortOrder: 5, isActive: true, isSystem: true, deletedAt: null },
      { id: 7, customerId: null, name: 'Proposal Sent', key: 'PROPOSAL_SENT', color: '#06B6D4', bgColor: '#CFFAFE', borderColor: '#A5F3FC', sortOrder: 6, isActive: true, isSystem: true, deletedAt: null },
      { id: 8, customerId: null, name: 'Negotiation', key: 'NEGOTIATION', color: '#EA580C', bgColor: '#FFEDD5', borderColor: '#FED7AA', sortOrder: 7, isActive: true, isSystem: true, deletedAt: null },
      { id: 9, customerId: null, name: 'Final Call', key: 'FINAL_CALL', color: '#EA580C', bgColor: '#FFEDD5', borderColor: '#FED7AA', sortOrder: 8, isActive: true, isSystem: true, deletedAt: null },
      { id: 10, customerId: null, name: 'Payment Pending', key: 'PAYMENT', color: '#2563EB', bgColor: '#DBEAFE', borderColor: '#BFDBFE', sortOrder: 9, isActive: true, isSystem: true, deletedAt: null },
      { id: 11, customerId: null, name: 'Work Started', key: 'WORK_STARTED', color: '#16A34A', bgColor: '#DCFCE7', borderColor: '#BBF7D0', sortOrder: 10, isActive: true, isSystem: true, deletedAt: null },
      { id: 12, customerId: null, name: 'Won', key: 'WON', color: '#16A34A', bgColor: '#DCFCE7', borderColor: '#BBF7D0', sortOrder: 11, isActive: true, isSystem: true, deletedAt: null },
      { id: 13, customerId: null, name: 'Converted', key: 'CONVERTED', color: '#16A34A', bgColor: '#DCFCE7', borderColor: '#BBF7D0', sortOrder: 12, isActive: true, isSystem: true, deletedAt: null },
      { id: 14, customerId: null, name: 'Lost', key: 'LOST', color: '#DC2626', bgColor: '#FFE4E6', borderColor: '#FECDD3', sortOrder: 13, isActive: true, isSystem: true, deletedAt: null },
      { id: 15, customerId: null, name: 'Cancelled', key: 'CANCELLED', color: '#DC2626', bgColor: '#FFE4E6', borderColor: '#FECDD3', sortOrder: 14, isActive: true, isSystem: true, deletedAt: null },
      { id: 16, customerId: null, name: 'Details Sent', key: 'DETAILS_SENT', color: '#4F46E5', bgColor: '#EEF2FF', borderColor: '#E0E7FF', sortOrder: 3, isActive: true, isSystem: true, deletedAt: null },
    ];

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
            if (where.stageId !== undefined && l.stageId !== where.stageId) return false;
            if (where.OR && Array.isArray(where.OR)) {
              const matchesOr = where.OR.some((cond: any) => {
                if (cond.stageId !== undefined && l.stageId === cond.stageId) return true;
                if (cond.status !== undefined && l.status === cond.status) return true;
                return false;
              });
              if (!matchesOr) return false;
            }
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
      leadStage: {
        findMany: jest.fn(async ({ where }) => {
          return stagesTable.filter((s) => {
            if (where.deletedAt === null && s.deletedAt !== null) return false;
            if (where.isActive === true && !s.isActive) return false;
            return true;
          }).map((s) => ({
            ...s,
            _count: {
              leads: leadsTable.filter((l) => l.deletedAt === null && (l.stageId === s.id || l.status === s.key)).length,
            },
          }));
        }),
        findFirst: jest.fn(async ({ where }) => {
          return stagesTable.find((s) => {
            if (where.deletedAt === null && s.deletedAt !== null) return false;
            if (where.id !== undefined && s.id !== where.id) return false;
            if (where.key !== undefined && s.key !== where.key) return false;
            return true;
          }) || null;
        }),
        create: jest.fn(async ({ data }) => {
          const newStage = {
            id: stagesTable.length + 1,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          stagesTable.push(newStage);
          return newStage;
        }),
        update: jest.fn(async ({ where, data }) => {
          const stage = stagesTable.find((s) => s.id === where.id);
          if (stage) Object.assign(stage, data);
          return stage;
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

  describe('5. Dynamic Lead Stage CRUD & Synchronized Management', () => {
    it('Creates a new dynamic stage with custom color and sort order', async () => {
      const created = await controller.createStage('1', { id: 1, role: 'SUPER_ADMIN' }, {
        name: 'Interested',
        color: '#10B981',
        sortOrder: 4,
        isActive: true,
      });

      expect(created).toBeDefined();
      expect(created.name).toBe('Interested');
      expect(created.key).toBe('INTERESTED');
      expect(created.color).toBe('#10B981');
      expect(created.sortOrder).toBe(4);
      expect(created.isActive).toBe(true);

      const stages = await controller.getStages('1');
      const found = stages.find((s) => s.name === 'Interested');
      expect(found).toBeDefined();
      expect(found?.leadsCount).toBe(0);
    });

    it('Updates stage name and color dynamically and reflects in stage list', async () => {
      const created = await controller.createStage('1', { id: 1, role: 'SUPER_ADMIN' }, {
        name: 'Interested',
        color: '#10B981',
        sortOrder: 4,
        isActive: true,
      });

      const updated = await controller.updateStage(
        '1',
        { id: 1, role: 'SUPER_ADMIN' },
        String(created.id),
        { name: 'Highly Interested', color: '#059669' },
      );

      expect(updated.name).toBe('Highly Interested');
      expect(updated.color).toBe('#059669');

      const stages = await controller.getStages('1');
      const found = stages.find((s) => s.id === created.id);
      expect(found?.name).toBe('Highly Interested');
    });

    it('Toggles stage active/inactive state and persists via API', async () => {
      const created = await controller.createStage('1', { id: 1, role: 'SUPER_ADMIN' }, {
        name: 'Proposal Review',
        color: '#3B82F6',
        sortOrder: 5,
        isActive: true,
      });

      const deactivated = await controller.updateStage(
        '1',
        { id: 1, role: 'SUPER_ADMIN' },
        String(created.id),
        { isActive: false },
      );

      expect(deactivated.isActive).toBe(false);

      const allStages = await controller.getStages('1', 'true');
      const deactivatedStage = allStages.find((s) => s.id === created.id);
      expect(deactivatedStage?.isActive).toBe(false);
    });

    it('Safely guards against deleting a stage when leads are assigned', async () => {
      // In the mock table, NEW has 3 leads assigned
      await expect(
        controller.deleteStage('1', { id: 1, role: 'SUPER_ADMIN' }, '1'),
      ).rejects.toThrow(/Cannot delete stage "New" because it is currently assigned/);
    });

    it('Allows deleting an unassigned stage safely', async () => {
      const unusedStage = await controller.createStage('1', { id: 1, role: 'SUPER_ADMIN' }, {
        name: 'Temporary Stage',
        color: '#6B7280',
        sortOrder: 99,
        isActive: true,
      });

      const deleteRes = await controller.deleteStage(
        '1',
        { id: 1, role: 'SUPER_ADMIN' },
        String(unusedStage.id),
      );

      expect(deleteRes).toBeDefined();
      expect(deleteRes.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('5. Status Update Validation & Normalization (UpdateLeadStatusDto)', () => {
    it('Normalizes Follow-up (FOLLOW_UP) to FOLLOW_UP without validation errors', async () => {
      const { plainToInstance } = await import('class-transformer');
      const { validate } = await import('class-validator');
      const { UpdateLeadStatusDto } = await import('./dto/lead.dto');

      const dto = plainToInstance(UpdateLeadStatusDto, { status: 'Follow-up (FOLLOW_UP)' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.status).toBe(LeadStatus.FOLLOW_UP);
    });

    it('Validates and transforms all 15 canonical lead statuses', async () => {
      const { plainToInstance } = await import('class-transformer');
      const { validate } = await import('class-validator');
      const { UpdateLeadStatusDto } = await import('./dto/lead.dto');

      const statuses = [
        'NEW',
        'FOLLOW_UP',
        'CONTACTED',
        'VISIT',
        'QUALIFIED',
        'PROPOSAL',
        'PROPOSAL_SENT',
        'FINAL_CALL',
        'NEGOTIATION',
        'PAYMENT',
        'WORK_STARTED',
        'WON',
        'LOST',
        'CANCELLED',
        'CONVERTED',
      ];

      for (const st of statuses) {
        const dto = plainToInstance(UpdateLeadStatusDto, { status: st });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
        expect(dto.status).toBe(st);
      }
    });

    it('Accepts UI labels with parentheses for other statuses too', async () => {
      const { plainToInstance } = await import('class-transformer');
      const { validate } = await import('class-validator');
      const { UpdateLeadStatusDto } = await import('./dto/lead.dto');

      const dto = plainToInstance(UpdateLeadStatusDto, { status: 'Visit Scheduled (VISIT)' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.status).toBe(LeadStatus.VISIT);
    });

    it('Validates stageId without status (authoritative dynamic stage flow)', async () => {
      const { plainToInstance } = await import('class-transformer');
      const { validate } = await import('class-validator');
      const { UpdateLeadStatusDto } = await import('./dto/lead.dto');

      const dto = plainToInstance(UpdateLeadStatusDto, { stageId: 16 });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.stageId).toBe(16);
      expect(dto.status).toBeUndefined();
    });

    it('Accepts custom dynamic stage strings without failing with enum validation error', async () => {
      const { plainToInstance } = await import('class-transformer');
      const { validate } = await import('class-validator');
      const { UpdateLeadStatusDto } = await import('./dto/lead.dto');

      const dto = plainToInstance(UpdateLeadStatusDto, { status: 'DOCUMENTS VERIFIED', stageId: 99 });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.status).toBe('DOCUMENTS_VERIFIED');
    });
  });

  describe('6. Dynamic Stage Management & Lead Details Transitions', () => {
    it('Transitions CONTACTED -> DETAILS_SENT using authoritative stageId and creates audit history', async () => {
      // 1. Move to CONTACTED first
      await service.updateStatus(1, 101, 999, { stageId: 2 });
      const contactedLead = await service.getLeadById(1, 101);
      expect(contactedLead.status).toBe(LeadStatus.CONTACTED);
      expect(contactedLead.stageId).toBe(2);

      // 2. Select DETAILS SENT (stageId: 16) without passing status
      const updated = await service.updateStatus(1, 101, 999, { stageId: 16 });
      expect(updated.stageId).toBe(16);
      expect(updated.status).toBe(LeadStatus.DETAILS_SENT);

      // 3. Verify history recorded actual stage IDs and statuses
      const lastHistory = statusHistoryTable[statusHistoryTable.length - 1];
      expect(lastHistory.fromStageId).toBe(2);
      expect(lastHistory.toStageId).toBe(16);
      expect(lastHistory.fromStatus).toBe(LeadStatus.CONTACTED);
      expect(lastHistory.toStatus).toBe(LeadStatus.DETAILS_SENT);
    });

    it('Transitions to a custom dynamic stage (DOCUMENTS VERIFIED) without enum errors', async () => {
      // 1. Move lead to DETAILS_SENT first
      await service.updateStatus(1, 101, 999, { stageId: 16 });
      const current = await service.getLeadById(1, 101);
      expect(current.status).toBe(LeadStatus.DETAILS_SENT);

      // 2. Create a custom dynamic stage in Stage Management
      const customStage = await service.createStage(1, { id: 999 }, {
        name: 'Documents Verified',
        color: '#8B5CF6',
        sortOrder: 15,
      });
      expect(customStage.id).toBeDefined();
      expect(customStage.name).toBe('Documents Verified');
      expect(customStage.key).toBe('DOCUMENTS_VERIFIED');

      // 3. Update lead to the custom stage using stageId
      const updated = await service.updateStatus(1, 101, 999, { stageId: customStage.id });
      expect(updated.stageId).toBe(customStage.id);
      // Status remains a valid enum (preserves DETAILS_SENT), does not crash with unknown enum
      expect(updated.status).toBe(LeadStatus.DETAILS_SENT);

      // 4. Verify history records the custom stage ID
      const lastHistory = statusHistoryTable[statusHistoryTable.length - 1];
      expect(lastHistory.fromStageId).toBe(16);
      expect(lastHistory.toStageId).toBe(customStage.id);
    });

    it('Enforces tenant isolation: rejects assigning another company’s stage', async () => {
      // Create stage belonging strictly to Customer 2
      const customer2Stage = await service.createStage(2, { id: 888 }, {
        name: 'Customer 2 Exclusive Stage',
        color: '#10B981',
      });

      // Customer 1 tries to use Customer 2's stage -> must throw ForbiddenException
      await expect(
        service.updateStatus(1, 101, 999, { stageId: customer2Stage.id }),
      ).rejects.toThrow('Lead stage does not belong to your company/workspace');
    });

    it('Guards against assigning an inactive stage to a lead', async () => {
      // Create an inactive stage
      const inactiveStage = await service.createStage(1, { id: 999 }, {
        name: 'Deprecated Archived Stage',
        isActive: false,
      });

      await expect(
        service.updateStatus(1, 101, 999, { stageId: inactiveStage.id }),
      ).rejects.toThrow('Cannot transition lead to inactive stage');
    });
  });
});

