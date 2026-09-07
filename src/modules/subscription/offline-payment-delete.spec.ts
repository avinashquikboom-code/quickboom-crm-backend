import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { PaymentMethod, RoleType, SubscriptionStatus } from '@prisma/client';

describe('Offline Payment Request Deletion (Single & Bulk) — Unit Tests', () => {
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
      paymentHistory: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      customerSubscription: {
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

  describe('1. Single Delete', () => {
    it('successfully soft-deletes a single pending offline payment request and cancels linked pending subscription', async () => {
      const mockPayment = {
        id: 55,
        customerId: 101,
        subscriptionId: 201,
        amount: 9999,
        status: 'PENDING',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        orderNumber: 'QB-OFFLINE-55',
        deletedAt: null,
        subscription: {
          id: 201,
          customerId: 101,
          status: SubscriptionStatus.PENDING,
        },
        customer: {
          id: 101,
          name: 'Test Tenant A',
        },
      };

      mockPrisma.paymentHistory.findFirst.mockResolvedValue(mockPayment);
      mockPrisma.paymentHistory.update.mockResolvedValue({ ...mockPayment, deletedAt: new Date() });
      mockPrisma.customerSubscription.update.mockResolvedValue({ id: 201, status: SubscriptionStatus.CANCELED });

      const result = await service.deleteOfflinePaymentRequest(55, mockSuperAdminUser);

      expect(result.success).toBe(true);
      expect(result.deletedId).toBe(55);
      expect(mockPrisma.paymentHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 55 },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      // Linked pending subscription is canceled
      expect(mockPrisma.customerSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 201 },
          data: expect.objectContaining({ status: SubscriptionStatus.CANCELED }),
        }),
      );
    });

    it('soft-deletes an approved/paid offline payment request WITHOUT canceling active subscription or touching customer', async () => {
      const mockPaidPayment = {
        id: 77,
        customerId: 101,
        subscriptionId: 301,
        amount: 19999,
        status: 'SUCCESS',
        paymentMethod: PaymentMethod.CASH,
        orderNumber: 'QB-OFFLINE-77',
        deletedAt: null,
        subscription: {
          id: 301,
          customerId: 101,
          status: SubscriptionStatus.ACTIVE,
        },
        customer: {
          id: 101,
          name: 'Test Tenant A',
        },
      };

      mockPrisma.paymentHistory.findFirst.mockResolvedValue(mockPaidPayment);
      mockPrisma.paymentHistory.update.mockResolvedValue({ ...mockPaidPayment, deletedAt: new Date() });

      const result = await service.deleteOfflinePaymentRequest(77, mockSuperAdminUser);

      expect(result.success).toBe(true);
      expect(mockPrisma.paymentHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 77 },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      // Active subscription is NOT touched
      expect(mockPrisma.customerSubscription.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if the payment request does not exist or was already deleted', async () => {
      mockPrisma.paymentHistory.findFirst.mockResolvedValue(null);

      await expect(service.deleteOfflinePaymentRequest(999, mockSuperAdminUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('2. Bulk Delete', () => {
    it('successfully bulk soft-deletes multiple offline payment requests atomically', async () => {
      const mockPayments = [
        {
          id: 10,
          customerId: 101,
          subscriptionId: 501,
          status: 'PENDING',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          subscription: { id: 501, status: SubscriptionStatus.PENDING },
        },
        {
          id: 11,
          customerId: 101,
          subscriptionId: 502,
          status: 'REJECTED',
          paymentMethod: PaymentMethod.CASH,
          subscription: { id: 502, status: SubscriptionStatus.CANCELED },
        },
        {
          id: 12,
          customerId: 101,
          subscriptionId: 503,
          status: 'SUCCESS',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          subscription: { id: 503, status: SubscriptionStatus.ACTIVE },
        },
      ];

      mockPrisma.paymentHistory.findMany.mockResolvedValue(mockPayments);
      mockPrisma.paymentHistory.updateMany.mockResolvedValue({ count: 3 });
      mockPrisma.customerSubscription.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.bulkDeleteOfflinePaymentRequests([10, 11, 12], mockSuperAdminUser);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
      expect(result.deletedIds).toEqual([10, 11, 12]);
      expect(mockPrisma.paymentHistory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [10, 11, 12] } },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      // Only the pending subscription (id 501) was marked CANCELED; active sub 503 is untouched
      expect(mockPrisma.customerSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [501] }, status: SubscriptionStatus.PENDING },
          data: expect.objectContaining({ status: SubscriptionStatus.CANCELED }),
        }),
      );
    });

    it('rejects empty ID array with BadRequestException', async () => {
      await expect(service.bulkDeleteOfflinePaymentRequests([], mockSuperAdminUser)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.bulkDeleteOfflinePaymentRequests(['abc' as any], mockSuperAdminUser)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('3. Authorization & RBAC', () => {
    it('allows Super Admin to delete any offline payment request', async () => {
      const mockPayment = {
        id: 1,
        customerId: 999,
        paymentMethod: PaymentMethod.CASH,
        status: 'PENDING',
      };
      mockPrisma.paymentHistory.findFirst.mockResolvedValue(mockPayment);
      mockPrisma.paymentHistory.update.mockResolvedValue(mockPayment);

      const res = await service.deleteOfflinePaymentRequest(1, mockSuperAdminUser);
      expect(res.success).toBe(true);
    });

    it('allows Tenant Admin to delete requests belonging to their organization', async () => {
      const mockPayment = {
        id: 2,
        customerId: 101, // matches mockTenantAdminUserA.customerId
        paymentMethod: PaymentMethod.CASH,
        status: 'PENDING',
      };
      mockPrisma.paymentHistory.findFirst.mockResolvedValue(mockPayment);
      mockPrisma.paymentHistory.update.mockResolvedValue(mockPayment);

      const res = await service.deleteOfflinePaymentRequest(2, mockTenantAdminUserA);
      expect(res.success).toBe(true);
    });

    it('rejects regular Employee with ForbiddenException', async () => {
      await expect(service.deleteOfflinePaymentRequest(1, mockEmployeeUser)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.bulkDeleteOfflinePaymentRequests([1, 2], mockEmployeeUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects Client / Customer role with ForbiddenException', async () => {
      await expect(service.deleteOfflinePaymentRequest(1, mockCustomerUser)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.bulkDeleteOfflinePaymentRequests([1, 2], mockCustomerUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects Unauthenticated requests with UnauthorizedException', async () => {
      await expect(service.deleteOfflinePaymentRequest(1, null)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.bulkDeleteOfflinePaymentRequests([1, 2], null)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('4. Tenant / Customer Isolation', () => {
    it('denies Tenant Admin from deleting a payment request belonging to another Tenant (Single)', async () => {
      const mockPayment = {
        id: 88,
        customerId: 202, // Belongs to Tenant B
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        status: 'PENDING',
      };
      mockPrisma.paymentHistory.findFirst.mockResolvedValue(mockPayment);

      // Tenant Admin A (customerId 101) tries to delete Tenant B's request (customerId 202)
      await expect(service.deleteOfflinePaymentRequest(88, mockTenantAdminUserA)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.paymentHistory.update).not.toHaveBeenCalled();
    });

    it('denies Tenant Admin from bulk deleting if ANY record belongs to another Tenant (Bulk)', async () => {
      const mockPayments = [
        {
          id: 101,
          customerId: 101, // Tenant A
          paymentMethod: PaymentMethod.CASH,
          status: 'PENDING',
        },
        {
          id: 202,
          customerId: 202, // Tenant B — cross-tenant violation!
          paymentMethod: PaymentMethod.CASH,
          status: 'PENDING',
        },
      ];
      mockPrisma.paymentHistory.findMany.mockResolvedValue(mockPayments);

      // Tenant Admin A tries to bulk delete
      await expect(
        service.bulkDeleteOfflinePaymentRequests([101, 202], mockTenantAdminUserA),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.paymentHistory.updateMany).not.toHaveBeenCalled();
    });
  });
});
