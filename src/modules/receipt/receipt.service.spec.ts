import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptService } from './receipt.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('ReceiptService Unit Tests', () => {
  let service: ReceiptService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      paymentHistory: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ReceiptService>(ReceiptService);
  });

  describe('1. Receipt Access Security & Scoping', () => {
    it('returns receipt details when customer matches and payment is PAID', async () => {
      const mockPayment = {
        id: 1,
        customerId: 101,
        invoiceUrl: 'REC-2026-000001',
        amount: 5899.5,
        taxAmount: 1061.91,
        totalAmount: 6961.41,
        status: 'PAID',
        paymentMethod: 'ONLINE',
        createdAt: new Date('2026-08-20'),
        customer: { id: 101, name: 'Client One', email: 'one@quikboom.com' },
        subscription: { plan: { name: 'Growth Plan' } },
      };

      prisma.paymentHistory.findFirst.mockResolvedValue(mockPayment);

      const res = await service.getReceipt('REC-2026-000001', 101, { role: 'CUSTOMER', customerId: 101 });
      expect(res.receiptId).toBe('REC-2026-000001');
      expect(res.status).toBe('PAID');
      expect(res.customer.name).toBe('Client One');
    });

    it('rejects access if customer ID does not match (Customer A accessing Customer B receipt)', async () => {
      const mockPayment = {
        id: 2,
        customerId: 102,
        invoiceUrl: 'REC-2026-000002',
        status: 'PAID',
      };

      prisma.paymentHistory.findFirst.mockResolvedValue(mockPayment);

      await expect(
        service.getReceipt('REC-2026-000002', 101, { role: 'CUSTOMER', customerId: 101 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects access if payment is in PENDING status (e.g. offline cash not yet approved)', async () => {
      const mockPayment = {
        id: 3,
        customerId: 101,
        invoiceUrl: 'REC-2026-000003',
        status: 'PENDING',
      };

      prisma.paymentHistory.findFirst.mockResolvedValue(mockPayment);

      await expect(
        service.getReceipt('REC-2026-000003', 101, { role: 'CUSTOMER', customerId: 101 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if receipt does not exist', async () => {
      prisma.paymentHistory.findFirst.mockResolvedValue(null);

      await expect(
        service.getReceipt('REC-9999-999999', 101, { role: 'CUSTOMER', customerId: 101 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
