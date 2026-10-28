import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { LeadController } from './lead.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { DataCaptureService } from '../data-capture/data-capture.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { CustomerMobilePermissionService } from '../customer/customer-mobile-permission.service';

describe('Lead Notes API Suite (GET /leads/:id/notes & POST /leads/:id/notes)', () => {
  let leadService: LeadService;
  let leadController: LeadController;
  let leadRepository: LeadRepository;

  const mockPrisma: any = {
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    leadNote: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    leadActivityTimeline: {
      create: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeadController],
      providers: [
        LeadService,
        LeadRepository,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
        { provide: DataCaptureService, useValue: {} },
        { provide: IntegrationSettingsService, useValue: {} },
        { provide: CustomerMobilePermissionService, useValue: {} },
      ],
    }).compile();

    leadService = module.get<LeadService>(LeadService);
    leadController = module.get<LeadController>(LeadController);
    leadRepository = module.get<LeadRepository>(LeadRepository);
  });

  describe('1. Existing lead with notes', () => {
    it('returns array of notes ordered by date desc with author information', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 987,
        customerId: 1,
        title: 'Acme Corp',
        notes: [],
      });

      const noteDate1 = new Date('2026-10-28T12:00:00Z');
      const noteDate2 = new Date('2026-10-27T10:00:00Z');

      mockPrisma.leadNote.findMany.mockResolvedValue([
        {
          id: 101,
          leadId: 987,
          userId: 5,
          content: 'Discussed quotation with client',
          createdAt: noteDate1,
          updatedAt: noteDate1,
          user: { id: 5, firstName: 'John', lastName: 'Doe' },
        },
        {
          id: 100,
          leadId: 987,
          userId: 6,
          content: 'Initial intake note',
          createdAt: noteDate2,
          updatedAt: noteDate2,
          user: { id: 6, firstName: 'Jane', lastName: 'Smith' },
        },
      ]);

      const result = await leadController.getNotes('1', '987', { id: 5, role: 'ADMIN' });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(101);
      expect(result[0].leadId).toBe(987);
      expect(result[0].content).toBe('Discussed quotation with client');
      expect(result[0].authorName).toBe('John Doe');
      expect(result[0].createdAt).toEqual(noteDate1);

      expect(result[1].id).toBe(100);
      expect(result[1].authorName).toBe('Jane Smith');
    });
  });

  describe('2. Existing lead without notes', () => {
    it('returns an empty array when no notes exist', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 987,
        customerId: 1,
        title: 'Acme Corp',
        workNotes: null,
      });

      mockPrisma.leadNote.findMany.mockResolvedValue([]);

      const result = await leadController.getNotes('1', '987', { id: 5, role: 'ADMIN' });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    });

    it('falls back to legacy workNotes if table notes are empty', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 987,
        customerId: 1,
        title: 'Acme Corp',
        workNotes: 'Important legacy note',
        createdAt: new Date('2026-10-20'),
        updatedAt: new Date('2026-10-20'),
        createdById: 2,
        createdBy: { id: 2, firstName: 'Alice', lastName: 'Wong' },
      });

      mockPrisma.leadNote.findMany.mockResolvedValue([]);

      const result = await leadController.getNotes('1', '987', { id: 5, role: 'ADMIN' });

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Important legacy note');
      expect(result[0].authorName).toBe('Alice Wong');
    });
  });

  describe('3. Nonexistent lead', () => {
    it('throws NotFoundException (404) when lead does not exist', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);

      await expect(
        leadController.getNotes('1', '999999', { id: 5, role: 'ADMIN' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException (400) for invalid numeric lead ID', async () => {
      await expect(
        leadController.getNotes('1', 'invalid-id', { id: 5, role: 'ADMIN' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. Unauthorized user / RBAC scope', () => {
    it('throws ForbiddenException (403) when employee is not assigned to the lead', async () => {
      // Non-admin employee user
      const employeeUser = {
        id: 20,
        role: 'EMPLOYEE',
        employee: { id: 10 },
      };

      // Lead assigned to a different employee (employeeId: 99, assignedToId: 99)
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 987,
        customerId: 1,
        employeeId: 99,
        assignedToId: 99,
        status: 'NEW',
        visits: [],
      });

      await expect(
        leadController.getNotes('1', '987', employeeUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('5. Add note operation (POST /leads/:id/notes)', () => {
    it('creates lead note in database and logs timeline', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 987,
        customerId: 1,
        title: 'Acme Corp',
      });

      const createdNote = {
        id: 201,
        leadId: 987,
        userId: 5,
        content: 'New client inquiry about website package',
        createdAt: new Date(),
        user: { id: 5, firstName: 'John', lastName: 'Doe' },
      };

      mockPrisma.leadNote.create.mockResolvedValue(createdNote);
      mockPrisma.leadActivityTimeline.create.mockResolvedValue({ id: 1 });

      const result = await leadController.addNote('1', '987', '5', {
        content: 'New client inquiry about website package',
      });

      expect(mockPrisma.leadNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            leadId: 987,
            userId: 5,
            content: 'New client inquiry about website package',
          },
        }),
      );

      expect(mockPrisma.leadActivityTimeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: 987,
            action: 'NOTE_ADDED',
          }),
        }),
      );

      expect(result).toEqual(createdNote);
    });
  });
});

