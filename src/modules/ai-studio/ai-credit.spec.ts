import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AiCreditService } from './ai-credit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';

describe('AiCreditService - Admin Credit Management', () => {
  let service: AiCreditService;

  const mockPrisma = {
    customer: {
      findUnique: jest.fn(),
    },
    aiCreditWallet: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    aiCreditTransaction: {
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    aiServiceConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrisma)),
  };

  const mockIntegrationSettings = {
    getRazorpayConfig: jest.fn(),
  };

  const mockAdminUser = {
    id: 1,
    name: 'Super Admin',
    email: 'admin@quickboom.com',
    role: 'SUPER_ADMIN',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiCreditService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IntegrationSettingsService, useValue: mockIntegrationSettings },
      ],
    }).compile();

    service = module.get<AiCreditService>(AiCreditService);
    jest.clearAllMocks();
  });

  describe('1. Add Credits (Admin)', () => {
    it('should atomically add credits to customer wallet and record CREDIT_GRANT transaction', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
      });
      mockPrisma.aiCreditWallet.findUnique.mockResolvedValue({
        id: 5,
        customerId: 10,
        balance: 50,
        totalEarned: 50,
        totalSpent: 0,
      });
      mockPrisma.aiCreditWallet.update.mockResolvedValue({
        id: 5,
        customerId: 10,
        balance: 100,
        totalEarned: 100,
        totalSpent: 0,
      });
      mockPrisma.aiCreditTransaction.create.mockResolvedValue({
        id: 101,
        walletId: 5,
        customerId: 10,
        amount: 50,
        balanceAfter: 100,
        type: 'CREDIT_GRANT',
        createdAt: new Date(),
      });

      const res = await service.addCreditsAdmin(
        10,
        { amount: 50, reason: 'Promotional onboarding bonus' },
        mockAdminUser,
      );

      expect(res.success).toBe(true);
      expect(res.balanceBefore).toBe(50);
      expect(res.balanceAfter).toBe(100);
      expect(res.amount).toBe(50);
      expect(mockPrisma.aiCreditWallet.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: {
          balance: 100,
          totalEarned: 100,
        },
      });
      expect(mockPrisma.aiCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletId: 5,
            customerId: 10,
            amount: 50,
            balanceAfter: 100,
            type: 'CREDIT_GRANT',
          }),
        }),
      );
    });

    it('should throw BadRequestException if amount is zero or negative', async () => {
      await expect(
        service.addCreditsAdmin(10, { amount: 0, reason: 'Zero amount' }, mockAdminUser),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.addCreditsAdmin(10, { amount: -10, reason: 'Negative amount' }, mockAdminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if reason is empty', async () => {
      await expect(
        service.addCreditsAdmin(10, { amount: 20, reason: '   ' }, mockAdminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.addCreditsAdmin(999, { amount: 50, reason: 'Test' }, mockAdminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('2. Reduce Credits (Admin)', () => {
    it('should atomically decrease customer wallet balance and record ADMIN_ADJUSTMENT transaction', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
      });
      mockPrisma.aiCreditWallet.findUnique.mockResolvedValue({
        id: 5,
        customerId: 10,
        balance: 100,
        totalEarned: 100,
        totalSpent: 0,
      });
      mockPrisma.aiCreditWallet.update.mockResolvedValue({
        id: 5,
        customerId: 10,
        balance: 70,
        totalSpent: 30,
      });
      mockPrisma.aiCreditTransaction.create.mockResolvedValue({
        id: 102,
        walletId: 5,
        customerId: 10,
        amount: -30,
        balanceAfter: 70,
        type: 'ADMIN_ADJUSTMENT',
        createdAt: new Date(),
      });

      const res = await service.reduceCreditsAdmin(
        10,
        { amount: 30, reason: 'Adjustment for cancelled trial' },
        mockAdminUser,
      );

      expect(res.success).toBe(true);
      expect(res.balanceBefore).toBe(100);
      expect(res.balanceAfter).toBe(70);
      expect(res.amount).toBe(30);
      expect(mockPrisma.aiCreditWallet.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: {
          balance: 70,
          totalSpent: 30,
        },
      });
      expect(mockPrisma.aiCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletId: 5,
            customerId: 10,
            amount: -30,
            balanceAfter: 70,
            type: 'ADMIN_ADJUSTMENT',
          }),
        }),
      );
    });

    it('should never allow balance to become negative', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
      });
      mockPrisma.aiCreditWallet.findUnique.mockResolvedValue({
        id: 5,
        customerId: 10,
        balance: 25,
        totalEarned: 25,
        totalSpent: 0,
      });

      await expect(
        service.reduceCreditsAdmin(
          10,
          { amount: 50, reason: 'Attempt to over-deduct' },
          mockAdminUser,
        ),
      ).rejects.toThrow(
        'Cannot reduce 50 credits: Current balance is only 25 credits. Balance cannot become negative.',
      );
    });
  });

  describe('3. Customer Wallet Inspection (Admin)', () => {
    it('should return customer wallet and parsed transaction history', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
        email: 'acme@test.com',
      });
      mockPrisma.aiCreditWallet.findUnique.mockResolvedValue({
        id: 5,
        customerId: 10,
        balance: 70,
        totalEarned: 100,
        totalSpent: 30,
      });
      mockPrisma.aiCreditTransaction.findMany.mockResolvedValue([
        {
          id: 102,
          walletId: 5,
          customerId: 10,
          amount: -30,
          balanceAfter: 70,
          type: 'ADMIN_ADJUSTMENT',
          notes: JSON.stringify({
            reason: 'Adjustment for cancelled trial',
            adminId: 1,
            balanceBefore: 100,
            balanceAfter: 70,
          }),
          createdAt: new Date(),
        },
        {
          id: 101,
          walletId: 5,
          customerId: 10,
          amount: 100,
          balanceAfter: 100,
          type: 'CREDIT_GRANT',
          notes: JSON.stringify({
            reason: 'Welcome grant',
            adminId: 1,
            balanceBefore: 0,
            balanceAfter: 100,
          }),
          createdAt: new Date(),
        },
      ]);

      const res = await service.getCustomerWalletAdmin(10);
      expect(res.customer.name).toBe('Acme Corp');
      expect(res.balance).toBe(70);
      expect(res.transactions).toHaveLength(2);
      expect(res.transactions[0].reason).toBe('Adjustment for cancelled trial');
      expect(res.transactions[0].adminId).toBe(1);
      expect(res.transactions[0].balanceBefore).toBe(100);
      expect(res.transactions[0].balanceAfter).toBe(70);
    });
  });
});
