import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadController } from './lead.controller';
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

    it('should safely soft-delete only requested leads [101, 102] leaving lead 103 untouched', async () => {
      const mockLeads = [
        { id: 101, customerId: 10, status: 'NEW', convertedCustomer: null },
        { id: 102, customerId: 10, status: 'CONTACTED', convertedCustomer: null },
      ];
      mockPrisma.lead.findMany.mockResolvedValue(mockLeads);

      // Only delete 101 and 102 (lead 103 is not in the request)
      const result = await service.bulkDeleteLeads(10, adminUser, [101, 102]);

      expect(result.success).toBe(true);
      expect(result.requested).toBe(2);
      expect(result.deleted).toBe(2);
      expect(mockLeadRepository.bulkSoftDelete).toHaveBeenCalledWith([101, 102], 10);
      // Verify lead 103 is completely excluded from bulkSoftDelete
      const deletedIds = mockLeadRepository.bulkSoftDelete.mock.calls[0][0];
      expect(deletedIds).toContain(101);
      expect(deletedIds).toContain(102);
      expect(deletedIds).not.toContain(103);
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

    it('should throw BadRequestException if id is the literal string "bulk"', async () => {
      await expect(service.deleteLead(10, 'bulk', { id: 1, role: 'COMPANY_ADMIN' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.deleteLead(10, 'BULK', { id: 1, role: 'COMPANY_ADMIN' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getLeadById safety guard', () => {
    it('should reject id="bulk" with BadRequestException and not query database', async () => {
      await expect(service.getLeadById(10, 'bulk')).rejects.toThrow(BadRequestException);
      await expect(service.getLeadById(10, 'BULK')).rejects.toThrow(BadRequestException);
      expect(mockLeadRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('LeadController - Route Matching & Handler Verification', () => {
    let controller: LeadController;
    let mockLeadService: any;

    beforeEach(() => {
      mockLeadService = {
        bulkDeleteLeads: jest.fn().mockResolvedValue({
          success: true,
          requested: 2,
          deleted: 2,
          deletedCount: 2,
          failed: 0,
          ids: [101, 102],
          results: [{ id: 101, success: true }, { id: 102, success: true }],
        }),
        deleteLead: jest.fn().mockResolvedValue({ success: true, message: 'Lead deleted successfully' }),
        getLeadById: jest.fn().mockResolvedValue({ id: 101, title: 'Test Lead' }),
      };
      controller = new LeadController(mockLeadService);
    });

    it('should register DELETE /leads/bulk route on bulkRemove handler', () => {
      const path = Reflect.getMetadata('path', controller.bulkRemove);
      const method = Reflect.getMetadata('method', controller.bulkRemove);
      expect(path).toBe('bulk');
      expect(method).toBe(RequestMethod.DELETE);
    });

    it('should register POST /leads/bulk-delete route on bulkRemovePost handler', () => {
      const path = Reflect.getMetadata('path', controller.bulkRemovePost);
      const method = Reflect.getMetadata('method', controller.bulkRemovePost);
      expect(path).toBe('bulk-delete');
      expect(method).toBe(RequestMethod.POST);
    });

    it('should register DELETE /leads/:id route on remove handler', () => {
      const path = Reflect.getMetadata('path', controller.remove);
      const method = Reflect.getMetadata('method', controller.remove);
      expect(path).toBe(':id');
      expect(method).toBe(RequestMethod.DELETE);
    });

    it('should route bulkRemove to service.bulkDeleteLeads with resolved numeric IDs', async () => {
      const user = { id: 1, role: 'COMPANY_ADMIN' };
      const dto = { ids: [101, 102], resolvedIds: [101, 102] } as any;

      const result = await controller.bulkRemove('10', user, dto);

      expect(mockLeadService.bulkDeleteLeads).toHaveBeenCalledWith('10', user, [101, 102]);
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
      expect(result.ids).toEqual([101, 102]);
    });

    it('should support fallback query parameter "ids" when body is empty (proxy compatibility)', async () => {
      const user = { id: 1, role: 'COMPANY_ADMIN' };
      const emptyDto = {} as any;

      await controller.bulkRemove('10', user, emptyDto, '201,202');

      expect(mockLeadService.bulkDeleteLeads).toHaveBeenCalledWith('10', user, [201, 202]);
    });

    it('should route remove to service.deleteLead for single numeric ID', async () => {
      const user = { id: 1, role: 'COMPANY_ADMIN' };

      const result: any = await controller.remove('10', user, 101);

      expect(mockLeadService.deleteLead).toHaveBeenCalledWith('10', 101, user);
      expect(result.success).toBe(true);
    });
  });
});
