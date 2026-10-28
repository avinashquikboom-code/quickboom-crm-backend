import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException, RequestMethod } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { RoleType, SubscriptionStatus } from '@prisma/client';

describe('Tenant Subscription Deletion (Single & Bulk) — Unit Tests', () => {
  let service: SubscriptionService;
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
      customerSubscription: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
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

    service = new SubscriptionService(mockPrisma as any);
  });

  describe('1. Single Subscription Delete', () => {
    it('successfully soft-deletes a single subscription (deletedAt set and status marked CANCELED)', async () => {
      const mockSub = {
        id: 50,
        customerId: 101,
        planId: 2,
        status: SubscriptionStatus.ACTIVE,
        deletedAt: null,
        plan: { id: 2, name: 'Growth Plan' },
      };

      mockPrisma.customerSubscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.customerSubscription.update.mockResolvedValue({
        ...mockSub,
        deletedAt: new Date(),
        status: SubscriptionStatus.CANCELED,
      });

      const result = await service.deleteCustomerSubscription(50, mockSuperAdminUser);

      expect(result.success).toBe(true);
      expect(mockPrisma.customerSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 50 },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
            status: SubscriptionStatus.CANCELED,
          }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DELETE_SUBSCRIPTION',
            module: 'SUBSCRIPTIONS',
            customerId: 101,
          }),
        }),
      );
    });

    it('allows a Tenant Admin to delete a subscription belonging to their organization', async () => {
      const mockSub = {
        id: 50,
        customerId: 101,
        planId: 2,
        status: SubscriptionStatus.ACTIVE,
        deletedAt: null,
        plan: { id: 2, name: 'Growth Plan' },
      };

      mockPrisma.customerSubscription.findFirst.mockResolvedValue(mockSub);
      mockPrisma.customerSubscription.update.mockResolvedValue({
        ...mockSub,
        deletedAt: new Date(),
        status: SubscriptionStatus.CANCELED,
      });

      const result = await service.deleteCustomerSubscription(50, mockTenantAdminUserA);
      expect(result.success).toBe(true);
    });

    it('rejects deletion with 403 Forbidden when Tenant Admin tries to delete another tenant subscription', async () => {
      const mockSub = {
        id: 50,
        customerId: 101, // Tenant A
        planId: 2,
        deletedAt: null,
        plan: { id: 2, name: 'Growth Plan' },
      };

      mockPrisma.customerSubscription.findFirst.mockResolvedValue(mockSub);

      await expect(service.deleteCustomerSubscription(50, mockTenantAdminUserB)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.customerSubscription.update).not.toHaveBeenCalled();
    });

    it('rejects deletion with 403 Forbidden when an Employee or Client attempts to delete', async () => {
      await expect(service.deleteCustomerSubscription(50, mockEmployeeUser)).rejects.toThrow(ForbiddenException);
      await expect(service.deleteCustomerSubscription(50, mockCustomerUser)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.customerSubscription.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when subscription does not exist or was already deleted', async () => {
      mockPrisma.customerSubscription.findFirst.mockResolvedValue(null);

      await expect(service.deleteCustomerSubscription(999, mockSuperAdminUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.customerSubscription.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for invalid subscription ID', async () => {
      await expect(service.deleteCustomerSubscription(0, mockSuperAdminUser)).rejects.toThrow(BadRequestException);
      await expect(service.deleteCustomerSubscription('invalid', mockSuperAdminUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('2. Bulk Subscription Delete', () => {
    it('successfully bulk soft-deletes multiple subscriptions in an atomic transaction', async () => {
      const mockSubs = [
        { id: 51, customerId: 101, status: SubscriptionStatus.ACTIVE, plan: { id: 1, name: 'Starter' }, deletedAt: null },
        { id: 52, customerId: 101, status: SubscriptionStatus.ACTIVE, plan: { id: 2, name: 'Growth' }, deletedAt: null },
      ];

      mockPrisma.customerSubscription.findMany.mockResolvedValue(mockSubs);
      mockPrisma.customerSubscription.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkDeleteCustomerSubscriptions([51, 52], mockSuperAdminUser);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
      expect(mockPrisma.customerSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [51, 52] } },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
            status: SubscriptionStatus.CANCELED,
          }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(2);
    });

    it('allows a Tenant Admin to bulk delete subscriptions belonging to their organization', async () => {
      const mockSubs = [
        { id: 51, customerId: 101, status: SubscriptionStatus.ACTIVE, plan: { id: 1, name: 'Starter' }, deletedAt: null },
        { id: 52, customerId: 101, status: SubscriptionStatus.ACTIVE, plan: { id: 2, name: 'Growth' }, deletedAt: null },
      ];

      mockPrisma.customerSubscription.findMany.mockResolvedValue(mockSubs);
      mockPrisma.customerSubscription.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkDeleteCustomerSubscriptions([51, 52], mockTenantAdminUserA);
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
    });

    it('rejects bulk deletion with 403 Forbidden if any selected subscription belongs to another tenant', async () => {
      const crossTenantSubs = [
        { id: 51, customerId: 101, status: SubscriptionStatus.ACTIVE, deletedAt: null },
        { id: 61, customerId: 202, status: SubscriptionStatus.ACTIVE, deletedAt: null }, // Tenant B!
      ];

      mockPrisma.customerSubscription.findMany.mockResolvedValue(crossTenantSubs);

      await expect(service.bulkDeleteCustomerSubscriptions([51, 61], mockTenantAdminUserA)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.customerSubscription.updateMany).not.toHaveBeenCalled();
    });

    it('allows Super Admin to bulk delete subscriptions across different tenants', async () => {
      const crossTenantSubs = [
        { id: 51, customerId: 101, status: SubscriptionStatus.ACTIVE, plan: { id: 1, name: 'Starter' }, deletedAt: null },
        { id: 61, customerId: 202, status: SubscriptionStatus.ACTIVE, plan: { id: 2, name: 'Growth' }, deletedAt: null },
      ];

      mockPrisma.customerSubscription.findMany.mockResolvedValue(crossTenantSubs);
      mockPrisma.customerSubscription.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkDeleteCustomerSubscriptions([51, 61], mockSuperAdminUser);
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
    });

    it('rejects bulk delete when unauthenticated (user is null/undefined)', async () => {
      await expect(service.bulkDeleteCustomerSubscriptions([51, 52], null)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects bulk delete when called by unauthorized employee', async () => {
      await expect(service.bulkDeleteCustomerSubscriptions([51, 52], mockEmployeeUser)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when empty or invalid IDs array provided', async () => {
      await expect(service.bulkDeleteCustomerSubscriptions([], mockSuperAdminUser)).rejects.toThrow(BadRequestException);
      await expect(service.bulkDeleteCustomerSubscriptions(['abc', 0, -5], mockSuperAdminUser)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when none of the requested subscriptions exist', async () => {
      mockPrisma.customerSubscription.findMany.mockResolvedValue([]);

      await expect(service.bulkDeleteCustomerSubscriptions([998, 999], mockSuperAdminUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.customerSubscription.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('SubscriptionController Route & Method Tests', () => {
    let controller: SubscriptionController;
    let mockSubscriptionService: any;

    beforeEach(() => {
      mockSubscriptionService = {
        bulkDeleteCustomerSubscriptions: jest.fn().mockResolvedValue({ success: true, deletedCount: 2 }),
        deleteCustomerSubscription: jest.fn().mockResolvedValue({ success: true, message: 'Deleted' }),
      };
      controller = new SubscriptionController(
        mockSubscriptionService,
        {} as any,
        {} as any,
      );
    });

    it('registers POST /admin/subscriptions/bulk-delete route and method correctly', () => {
      const paths = Reflect.getMetadata('path', controller.bulkDeleteSubscriptions);
      const method = Reflect.getMetadata('method', controller.bulkDeleteSubscriptions);

      expect(paths).toContain('admin/subscriptions/bulk-delete');
      expect(paths).toContain('subscriptions/bulk-delete');
      expect(method).toBe(RequestMethod.POST);
    });

    it('registers DELETE /admin/subscriptions/bulk and bulk-delete correctly', () => {
      const paths = Reflect.getMetadata('path', controller.bulkDeleteSubscriptionsViaDelete);
      const method = Reflect.getMetadata('method', controller.bulkDeleteSubscriptionsViaDelete);

      expect(paths).toContain('admin/subscriptions/bulk');
      expect(paths).toContain('admin/subscriptions/bulk-delete');
      expect(method).toBe(RequestMethod.DELETE);
    });

    it('registers single DELETE /admin/subscriptions/:subscriptionId correctly', () => {
      const paths = Reflect.getMetadata('path', controller.deleteSubscription);
      const method = Reflect.getMetadata('method', controller.deleteSubscription);

      expect(paths).toContain('admin/subscriptions/:subscriptionId');
      expect(method).toBe(RequestMethod.DELETE);
    });

    it('delegates POST bulk delete with ids in body to service', async () => {
      const res = await controller.bulkDeleteSubscriptions({ ids: [51, 52] }, undefined as any, mockSuperAdminUser);
      expect(mockSubscriptionService.bulkDeleteCustomerSubscriptions).toHaveBeenCalledWith([51, 52], mockSuperAdminUser);
      expect(res.success).toBe(true);
    });

    it('delegates POST bulk delete with query param ids to service', async () => {
      const res = await controller.bulkDeleteSubscriptions({}, '51,52', mockSuperAdminUser);
      expect(mockSubscriptionService.bulkDeleteCustomerSubscriptions).toHaveBeenCalledWith(['51', '52'], mockSuperAdminUser);
      expect(res.success).toBe(true);
    });

    it('delegates DELETE single subscription to service', async () => {
      const res = await controller.deleteSubscription('51', mockSuperAdminUser);
      expect(mockSubscriptionService.deleteCustomerSubscription).toHaveBeenCalledWith('51', mockSuperAdminUser);
      expect(res.success).toBe(true);
    });
  });
});

