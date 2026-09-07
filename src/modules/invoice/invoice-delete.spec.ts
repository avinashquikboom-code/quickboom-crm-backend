import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceStatus, RoleType } from '@prisma/client';

describe('Invoice Deletion (Single & Bulk) — Unit Tests', () => {
  let service: InvoiceService;
  let mockPrisma: any;

  const mockSuperAdminUser = {
    id: 1,
    role: RoleType.SUPER_ADMIN,
    email: 'superadmin@quikboom.com',
  };

  const mockTenantAdminUserA = {
    id: 10,
    customerId: 101,
    role: RoleType.CUSTOMER_ADMIN,
    email: 'admin@tenant-a.com',
  };

  const mockTenantAdminUserB = {
    id: 20,
    customerId: 202,
    role: RoleType.CUSTOMER_ADMIN,
    email: 'admin@tenant-b.com',
  };

  const mockEmployeeUser = {
    id: 30,
    customerId: 101,
    role: RoleType.SALES_EXECUTIVE,
    email: 'sales@tenant-a.com',
  };

  const mockCustomerUser = {
    id: 40,
    customerId: 101,
    role: 'CLIENT',
    email: 'client@tenant-a.com',
  };

  beforeEach(() => {
    mockPrisma = {
      invoice: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
    };

    service = new InvoiceService(mockPrisma as any);
  });

  describe('1. Single Invoice Delete', () => {
    it('successfully soft-deletes a single invoice (deletedAt set and status marked CANCELLED)', async () => {
      const mockInvoice = {
        id: 100,
        customerId: 101,
        invoiceNo: 'INV-2026-001',
        totalAmount: 15000,
        status: InvoiceStatus.PENDING,
        deletedAt: null,
      };

      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.invoice.update.mockResolvedValue({
        ...mockInvoice,
        deletedAt: new Date(),
        status: InvoiceStatus.CANCELLED,
      });

      const result = await service.remove(101, 100, mockSuperAdminUser);

      expect(result.success).toBe(true);
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100 },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
            status: InvoiceStatus.CANCELLED,
          }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DELETE_INVOICE',
            module: 'INVOICES',
            customerId: 101,
          }),
        }),
      );
    });

    it('allows a Tenant Admin to delete an invoice belonging to their organization', async () => {
      const mockInvoice = {
        id: 100,
        customerId: 101,
        invoiceNo: 'INV-2026-001',
        totalAmount: 15000,
        status: InvoiceStatus.PENDING,
        deletedAt: null,
      };

      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.invoice.update.mockResolvedValue({
        ...mockInvoice,
        deletedAt: new Date(),
        status: InvoiceStatus.CANCELLED,
      });

      const result = await service.remove(101, 100, mockTenantAdminUserA);
      expect(result.success).toBe(true);
    });

    it('rejects deletion with 403 Forbidden when Tenant Admin tries to delete an invoice from another organization', async () => {
      const mockInvoice = {
        id: 100,
        customerId: 101, // Tenant A
        invoiceNo: 'INV-2026-001',
        deletedAt: null,
      };

      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);

      await expect(service.remove(101, 100, mockTenantAdminUserB)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('rejects deletion with 403 Forbidden when an Employee or Client attempts to delete', async () => {
      await expect(service.remove(101, 100, mockEmployeeUser)).rejects.toThrow(ForbiddenException);
      await expect(service.remove(101, 100, mockCustomerUser)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when invoice does not exist or was already deleted', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);

      await expect(service.remove(101, 999, mockSuperAdminUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for invalid invoice ID', async () => {
      await expect(service.remove(101, 0, mockSuperAdminUser)).rejects.toThrow(BadRequestException);
      await expect(service.remove(101, 'invalid', mockSuperAdminUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('2. Bulk Invoice Delete', () => {
    it('successfully bulk soft-deletes selected invoices in an atomic transaction', async () => {
      const mockInvoices = [
        { id: 101, customerId: 101, invoiceNo: 'INV-1', totalAmount: 5000, deletedAt: null },
        { id: 102, customerId: 101, invoiceNo: 'INV-2', totalAmount: 7500, deletedAt: null },
      ];

      mockPrisma.invoice.findMany.mockResolvedValue(mockInvoices);
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkRemove([101, 102], mockSuperAdminUser);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [101, 102] } },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
            status: InvoiceStatus.CANCELLED,
          }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(2);
    });

    it('allows a Tenant Admin to bulk delete invoices belonging to their organization', async () => {
      const mockInvoices = [
        { id: 101, customerId: 101, invoiceNo: 'INV-1', totalAmount: 5000, deletedAt: null },
        { id: 102, customerId: 101, invoiceNo: 'INV-2', totalAmount: 7500, deletedAt: null },
      ];

      mockPrisma.invoice.findMany.mockResolvedValue(mockInvoices);
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkRemove([101, 102], mockTenantAdminUserA);
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
    });

    it('rejects bulk deletion with 403 Forbidden if any selected invoice belongs to another tenant', async () => {
      const crossTenantInvoices = [
        { id: 101, customerId: 101, invoiceNo: 'INV-1', deletedAt: null },
        { id: 201, customerId: 202, invoiceNo: 'INV-2', deletedAt: null }, // Tenant B invoice!
      ];

      mockPrisma.invoice.findMany.mockResolvedValue(crossTenantInvoices);

      await expect(service.bulkRemove([101, 201], mockTenantAdminUserA)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.invoice.updateMany).not.toHaveBeenCalled();
    });

    it('allows Super Admin to bulk delete invoices across different tenants', async () => {
      const crossTenantInvoices = [
        { id: 101, customerId: 101, invoiceNo: 'INV-1', totalAmount: 5000, deletedAt: null },
        { id: 201, customerId: 202, invoiceNo: 'INV-2', totalAmount: 9000, deletedAt: null },
      ];

      mockPrisma.invoice.findMany.mockResolvedValue(crossTenantInvoices);
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkRemove([101, 201], mockSuperAdminUser);
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
    });

    it('rejects bulk delete when unauthenticated (user is null/undefined)', async () => {
      await expect(service.bulkRemove([101, 102], null)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects bulk delete when called by unauthorized employee', async () => {
      await expect(service.bulkRemove([101, 102], mockEmployeeUser)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when empty or invalid IDs array provided', async () => {
      await expect(service.bulkRemove([], mockSuperAdminUser)).rejects.toThrow(BadRequestException);
      await expect(service.bulkRemove(['abc', 0, -5], mockSuperAdminUser)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when none of the requested invoices exist', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);

      await expect(service.bulkRemove([998, 999], mockSuperAdminUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.invoice.updateMany).not.toHaveBeenCalled();
    });
  });
});
