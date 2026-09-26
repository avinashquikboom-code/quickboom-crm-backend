import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService } from '../email/email-template.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { S3Service } from '../s3/s3.service';

describe('LeadService - Bulk Delete & Safe Delete', () => {
  let service: LeadService;
  let mockPrisma: any;
  let mockLeadRepository: any;

  beforeEach(async () => {
    mockPrisma = {
      lead: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    mockLeadRepository = {
      softDelete: jest.fn().mockResolvedValue({ count: 1 }),
      bulkSoftDelete: jest.fn().mockResolvedValue({ count: 2 }),
      logTimeline: jest.fn().mockResolvedValue({ id: 1 }),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadService,
        { provide: LeadRepository, useValue: mockLeadRepository },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: {} },
        { provide: PlanAccessService, useValue: {} },
        { provide: LeadLimitService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: EmailTemplateService, useValue: {} },
        { provide: WhatsappService, useValue: {} },
        { provide: S3Service, useValue: {} },
      ],
    }).compile();

    service = module.get<LeadService>(LeadService);
  });

  describe('bulkDeleteLeads', () => {
    const adminUser = { id: 1, role: 'COMPANY_ADMIN', customerId: 10 };
    const employeeUser = { id: 5, role: 'EMPLOYEE', customerId: 10, employee: { id: 20 } };

    it('should throw BadRequestException if ids array is empty', async () => {
      await expect(service.bulkDeleteLeads(10, adminUser, [])).rejects.toThrow(BadRequestException);
    });

    it('should successfully bulk soft-delete valid leads for an admin', async () => {
      const mockLeads = [
        { id: 101, customerId: 10, status: 'NEW', convertedCustomer: null },
        { id: 102, customerId: 10, status: 'CONTACTED', convertedCustomer: null },
      ];
      mockPrisma.lead.findMany.mockResolvedValue(mockLeads);

      const result = await service.bulkDeleteLeads(10, adminUser, [101, 102]);

      expect(result.success).toBe(true);
      expect(result.requested).toBe(2);
      expect(result.deleted).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockLeadRepository.bulkSoftDelete).toHaveBeenCalledWith([101, 102], 10);
      expect(mockLeadRepository.logTimeline).toHaveBeenCalledTimes(2);
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('should enforce tenant isolation and reject foreign leads', async () => {
      const mockLeads = [
        { id: 101, customerId: 10, status: 'NEW', convertedCustomer: null },
        { id: 102, customerId: 99, status: 'NEW', convertedCustomer: null }, // Foreign tenant lead
      ];
      mockPrisma.lead.findMany.mockResolvedValue(mockLeads);

      const result = await service.bulkDeleteLeads(10, adminUser, [101, 102]);

      expect(result.requested).toBe(2);
      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
      const foreignResult = result.results.find((r) => r.id === 102);
      expect(foreignResult?.success).toBe(false);
      expect(foreignResult?.message).toContain('Lead does not belong to your company/tenant.');
      expect(mockLeadRepository.bulkSoftDelete).toHaveBeenCalledWith([101], 10);
    });

    it('should prevent deletion of converted leads and return clear reason', async () => {
      const mockLeads = [
        { id: 101, customerId: 10, status: 'NEW', convertedCustomer: null },
        { id: 102, customerId: 10, status: 'CONVERTED', convertedCustomer: { id: 50 }, convertedAt: new Date() },
      ];
      mockPrisma.lead.findMany.mockResolvedValue(mockLeads);

      const result = await service.bulkDeleteLeads(10, adminUser, [101, 102]);

      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
      const convertedResult = result.results.find((r) => r.id === 102);
      expect(convertedResult?.success).toBe(false);
      expect(convertedResult?.message).toBe('Lead cannot be deleted because it has been converted to a Customer.');
    });

    it('should enforce employee assignment scope for employee role', async () => {
      const mockLeads = [
        { id: 101, customerId: 10, assignedToId: 5, employeeId: 20, createdById: 99, convertedCustomer: null }, // Assigned to employee
        { id: 102, customerId: 10, assignedToId: 88, employeeId: 77, createdById: 99, convertedCustomer: null }, // Not assigned to employee
      ];
      mockPrisma.lead.findMany.mockResolvedValue(mockLeads);

      const result = await service.bulkDeleteLeads(10, employeeUser, [101, 102]);

      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
      const unassignedResult = result.results.find((r) => r.id === 102);
      expect(unassignedResult?.success).toBe(false);
      expect(unassignedResult?.message).toContain('You do not have permission to delete this lead as it is not assigned to you.');
      expect(mockLeadRepository.bulkSoftDelete).toHaveBeenCalledWith([101], 10);
    });
  });

  describe('deleteLead (single delete)', () => {
    it('should throw BadRequestException if lead is converted', async () => {
      mockLeadRepository.findOne.mockResolvedValue({
        id: 101,
        customerId: 10,
        status: 'CONVERTED',
        convertedCustomer: { id: 1 },
      });

      await expect(service.deleteLead(10, 101, { id: 1, role: 'COMPANY_ADMIN' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ForbiddenException if employee attempts to delete unassigned lead', async () => {
      mockLeadRepository.findOne.mockResolvedValue({
        id: 101,
        customerId: 10,
        assignedToId: 999,
        employeeId: 888,
        createdById: 777,
      });

      await expect(
        service.deleteLead(10, 101, { id: 5, role: 'EMPLOYEE', employee: { id: 20 } }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
