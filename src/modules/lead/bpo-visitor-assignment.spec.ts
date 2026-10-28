import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { LeadController } from './lead.controller';
import { MobileVisitController } from '../visit/mobile-visit.controller';
import { VisitService } from '../visit/visit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { DataCaptureService } from '../data-capture/data-capture.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { CustomerMobilePermissionService } from '../customer/customer-mobile-permission.service';
import { VisitStatus } from '@prisma/client';

describe('BPO Visitor Assignment & Visit Done Workflow Suite', () => {
  let leadService: LeadService;
  let leadController: LeadController;
  let mobileVisitController: MobileVisitController;

  const mockPrisma: any = {
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    visit: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    leadStage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    leadActivityTimeline: {
      create: jest.fn(),
    },
  };

  const mockVisitService: any = {
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeadController, MobileVisitController],
      providers: [
        LeadService,
        LeadRepository,
        { provide: VisitService, useValue: mockVisitService },
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
    mobileVisitController = module.get<MobileVisitController>(MobileVisitController);
  });

  const bpoUser = { id: 10, role: 'EMPLOYEE', roles: ['EMPLOYEE'], customerId: 1, permissions: [{ module: 'VISITS', action: 'CREATE' }, { module: 'LEADS', action: 'VIEW' }] };
  const visitorAUser = { id: 20, role: 'EMPLOYEE', roleType: 'VISITOR', customerId: 1 };
  const visitorBUser = { id: 30, role: 'EMPLOYEE', roleType: 'VISITOR', customerId: 1 };

  const visitorAEmp = {
    id: 101,
    userId: 20,
    firstName: 'Visitor',
    lastName: 'Alpha',
    status: 'ACTIVE',
    customerId: 1,
    designation: { id: 11, name: 'Field Visitor', code: 'VISITOR' },
  };

  const visitorBEmp = {
    id: 102,
    userId: 30,
    firstName: 'Visitor',
    lastName: 'Beta',
    status: 'ACTIVE',
    customerId: 1,
    designation: { id: 11, name: 'Field Visitor', code: 'VISITOR' },
  };

  const inactiveVisitorEmp = {
    id: 103,
    userId: 40,
    firstName: 'Visitor',
    lastName: 'Inactive',
    status: 'INACTIVE',
    customerId: 1,
    designation: { id: 11, name: 'Field Visitor', code: 'VISITOR' },
  };

  const telecallerEmp = {
    id: 104,
    userId: 50,
    firstName: 'Telecaller',
    lastName: 'One',
    status: 'ACTIVE',
    customerId: 1,
    designation: { id: 5, name: 'Telesales Executive', code: 'BPO' },
  };

  describe('1. BPO schedules visit & selects Visitor A', () => {
    it('successfully schedules visit and assigns lead to Visitor A', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 500,
        customerId: 1,
        companyName: 'Acme Corp',
        status: 'NEW',
        assignedToId: 10,
        deletedAt: null,
      });
      mockPrisma.lead.findUnique.mockResolvedValue({
        id: 500,
        customerId: 1,
        companyName: 'Acme Corp',
        status: 'NEW',
        assignedToId: 10,
      });
      mockPrisma.employee.findUnique.mockResolvedValue(visitorAEmp);
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 10, firstName: 'BPO', lastName: 'User' });
      mockPrisma.employee.create.mockResolvedValue({ id: 99, firstName: 'BPO', lastName: 'User' });
      mockPrisma.visit.findFirst.mockResolvedValue(null);
      mockPrisma.visit.create.mockResolvedValue({ id: 1, employeeId: 101, status: 'SCHEDULED' });
      mockPrisma.leadStage.findFirst.mockResolvedValue({ id: 4, key: 'VISIT_SCHEDULED', name: 'Visit Scheduled' });
      mockPrisma.lead.update.mockResolvedValue({ id: 500, status: 'VISIT_SCHEDULED', employeeId: 101 });
      mockPrisma.leadActivityTimeline.create.mockResolvedValue({});

      const result = await leadController.manageVisit(
        '1',
        '500',
        '10',
        {
          action: 'SCHEDULE',
          employeeId: 101,
          date: '2026-10-30',
          time: '11:00 AM',
          purpose: 'Product Demo',
          location: 'Client HQ',
        },
        bpoUser,
      );

      expect(mockPrisma.employee.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 101 } }),
      );
      expect(mockPrisma.visit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            employeeId: 101,
            leadId: 500,
            status: 'SCHEDULED',
          }),
        }),
      );
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 500 },
          data: expect.objectContaining({
            employeeId: 101,
            status: 'VISIT_SCHEDULED',
          }),
        }),
      );
    });
  });

  describe('2. Validation & rejection of invalid visitor assignment', () => {
    it('rejects nonexistent employee ID', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 500, customerId: 1, assignedToId: 10 });
      mockPrisma.employee.findUnique.mockResolvedValue(null);

      await expect(
        leadController.manageVisit(
          '1',
          '500',
          '10',
          { action: 'SCHEDULE', employeeId: 999 },
          bpoUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects inactive employee', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 500, customerId: 1, assignedToId: 10 });
      mockPrisma.employee.findUnique.mockResolvedValue(inactiveVisitorEmp);

      await expect(
        leadController.manageVisit(
          '1',
          '500',
          '10',
          { action: 'SCHEDULE', employeeId: 103 },
          bpoUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects active employee who does not have Visitor role/designation', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 500, customerId: 1, assignedToId: 10 });
      mockPrisma.employee.findUnique.mockResolvedValue(telecallerEmp);

      await expect(
        leadController.manageVisit(
          '1',
          '500',
          '10',
          { action: 'SCHEDULE', employeeId: 104 },
          bpoUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('3. Visitor permission restrictions', () => {
    it('visitor cannot schedule or reassign visits', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 500, customerId: 1, employeeId: 101 });
      mockPrisma.employee.findFirst.mockResolvedValue(visitorAEmp);

      await expect(
        leadController.manageVisit(
          '1',
          '500',
          '20',
          { action: 'SCHEDULE', employeeId: 102 },
          visitorAUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('visitor cannot change lead stage to non-Visit-Done stages', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 500,
        customerId: 1,
        employeeId: 101,
        status: 'VISIT_SCHEDULED',
        stage: { id: 4, key: 'VISIT_SCHEDULED', name: 'Visit Scheduled' },
      });
      mockPrisma.employee.findFirst.mockResolvedValue(visitorAEmp);
      mockPrisma.leadStage.findFirst.mockResolvedValue({ id: 1, key: 'WON', name: 'Won' });

      await expect(
        leadService.updateStatus(
          '1',
          '500',
          '20',
          { status: 'WON' as any },
          visitorAUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('4. Visitor lead isolation & visibility', () => {
    it('Visitor A receives their assigned scheduled visits', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(visitorAEmp);
      mockPrisma.visit.findMany.mockResolvedValue([
        {
          id: 1,
          employeeId: 101,
          customerName: 'Acme Corp',
          status: VisitStatus.SCHEDULED,
          date: new Date(),
          lead: { id: 500, companyName: 'Acme Corp', employeeId: 101 },
        },
      ]);
      mockPrisma.leadStage.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue([]);

      const result = await mobileVisitController.getMyVisits(visitorAUser, '1', undefined, 'upcoming');
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe(1);
    });

    it('Visitor B cannot see Visitor A lead or visit', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(visitorBEmp);
      // Query executes with employeeId: 102 (Visitor B), which matches 0 visits
      mockPrisma.visit.findMany.mockImplementation((args: any) => {
        const andFilters = args?.where?.AND || [];
        const hasEmpBFilter = andFilters.some((f: any) =>
          f?.OR?.some((o: any) => o?.employeeId === 102 || o?.lead?.employeeId === 102),
        );
        return hasEmpBFilter ? [] : [{ id: 1, employeeId: 101 }];
      });
      mockPrisma.leadStage.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue([]);

      const result = await mobileVisitController.getMyVisits(visitorBUser, '1', undefined, 'upcoming');
      expect(result.items.length).toBe(0);
    });

    it('Visitor B cannot view Visitor A single visit details', async () => {
      mockPrisma.visit.findUnique.mockResolvedValue({
        id: 1,
        employeeId: 101, // Belongs to Visitor A
        lead: { employeeId: 101 },
      });
      mockPrisma.employee.findFirst.mockResolvedValue(visitorBEmp); // Visitor B requesting

      await expect(
        mobileVisitController.getVisitById(visitorBUser, '1', '1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Visitor B cannot check-in to Visitor A visit', async () => {
      mockPrisma.visit.findUnique.mockResolvedValue({
        id: 1,
        employeeId: 101,
        lead: { employeeId: 101 },
      });
      mockPrisma.employee.findFirst.mockResolvedValue(visitorBEmp);

      await expect(
        mobileVisitController.checkIn(visitorBUser, '1', '1', { latitude: 19.0, longitude: 72.8 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Visitor B cannot complete Visitor A visit', async () => {
      mockPrisma.visit.findUnique.mockResolvedValue({
        id: 1,
        employeeId: 101,
        lead: { employeeId: 101 },
      });
      mockPrisma.employee.findFirst.mockResolvedValue(visitorBEmp);

      await expect(
        mobileVisitController.completeVisit(visitorBUser, '1', '1', { notes: 'Hack complete' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('5. Visitor A completes visit (Visit Done workflow)', () => {
    it('marks visit COMPLETED, updates lead to VISIT_DONE, and logs timeline', async () => {
      mockPrisma.visit.findUnique.mockResolvedValue({
        id: 1,
        employeeId: 101,
        leadId: 500,
        customerId: 1,
        lead: { employeeId: 101 },
      });
      mockPrisma.employee.findFirst.mockResolvedValue(visitorAEmp);
      mockVisitService.update.mockResolvedValue({
        id: 1,
        status: VisitStatus.COMPLETED,
        completedById: 101,
      });
      mockPrisma.leadStage.findFirst.mockResolvedValue({ id: 5, key: 'VISIT_DONE', name: 'Visit Done' });
      mockPrisma.lead.update.mockResolvedValue({ id: 500, status: 'VISIT_DONE', stageId: 5 });
      mockPrisma.leadActivityTimeline.create.mockResolvedValue({});

      const res = await mobileVisitController.completeVisit(
        visitorAUser,
        '1',
        '1',
        { notes: 'Demo went great. Client requested commercial proposal.', outcome: 'Interested' },
      );

      expect(mockVisitService.update).toHaveBeenCalledWith(
        1,
        '1',
        expect.objectContaining({
          status: VisitStatus.COMPLETED,
          completedById: 101,
        }),
      );
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 500 },
          data: expect.objectContaining({
            status: 'VISIT_DONE',
            stageId: 5,
          }),
        }),
      );
      expect(mockPrisma.leadActivityTimeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: 500,
            action: 'VISIT_COMPLETED',
          }),
        }),
      );
    });
  });
});
