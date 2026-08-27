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
      customPlanOrder: {
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

  describe('1. Receipt Identifier Lookup & Resolution', () => {
    it('resolves receipt by explicit REC format (e.g. REC-2026-000001)', async () => {
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

    it('resolves receipt by document identifier (e.g. DOC-6)', async () => {
      const mockPayment = {
        id: 6,
        customerId: 101,
        invoiceUrl: null,
        amount: 12000,
        taxAmount: 2160,
        totalAmount: 14160,
        status: 'PAID',
        paymentMethod: 'RAZORPAY',
        createdAt: new Date('2026-08-20'),
        customer: { id: 101, name: 'Client Six', email: 'six@quikboom.com' },
        subscription: { plan: { name: 'Enterprise Plan' } },
      };

      // Exact match returns null, then pattern extraction finds id: 6
      prisma.paymentHistory.findFirst.mockResolvedValue(null);
      prisma.customPlanOrder.findFirst.mockResolvedValue(null);
      prisma.paymentHistory.findUnique.mockResolvedValue(mockPayment);

      const res = await service.getReceipt('DOC-6', 101, { role: 'CUSTOMER', customerId: 101 });
      expect(res.receiptNumber).toBe('REC-2026-000006');
      expect(res.documentNumber).toBe('DOC-6');
      expect(res.status).toBe('PAID');
      expect(res.customer.name).toBe('Client Six');
    });

    it('resolves receipt by numeric ID (e.g. "6")', async () => {
      const mockPayment = {
        id: 6,
        customerId: 101,
        invoiceUrl: 'REC-2026-000006',
        amount: 12000,
        taxAmount: 2160,
        totalAmount: 14160,
        status: 'PAID',
        paymentMethod: 'RAZORPAY',
        createdAt: new Date('2026-08-20'),
        customer: { id: 101, name: 'Client Six', email: 'six@quikboom.com' },
        subscription: { plan: { name: 'Enterprise Plan' } },
      };

      prisma.paymentHistory.findFirst.mockResolvedValue(null);
      prisma.paymentHistory.findUnique.mockResolvedValue(mockPayment);

      const res = await service.getReceipt('6', 101, { role: 'CUSTOMER', customerId: 101 });
      expect(res.receiptId).toBe('REC-2026-000006');
      expect(res.status).toBe('PAID');
    });

    it('resolves custom plan order receipt (e.g. REC-2026-CP0006)', async () => {
      const mockCustomOrder = {
        id: 6,
        customerId: 101,
        orderNumber: 'ORD-CUST-6',
        selectedFeatures: { extraUsers: 5 },
        duration: 3,
        durationUnit: 'MONTH',
        subtotal: 15000,
        tax: 2700,
        totalAmount: 17700,
        status: 'PAID',
        paymentMethod: 'RAZORPAY',
        createdAt: new Date('2026-08-20'),
        customer: { id: 101, name: 'Client Six', email: 'six@quikboom.com' },
      };

      prisma.paymentHistory.findFirst.mockResolvedValue(null);
      prisma.customPlanOrder.findFirst.mockResolvedValue(null);
      prisma.customPlanOrder.findUnique.mockResolvedValue(mockCustomOrder);

      const res = await service.getReceipt('REC-2026-CP0006', 101, { role: 'CUSTOMER', customerId: 101 });
      expect(res.receiptNumber).toBe('REC-2026-CP0006');
      expect(res.status).toBe('PAID');
      expect(res.plan.name).toBe('Custom Plan (3 months)');
    });
  });

  describe('2. Receipt Access Security & Scoping', () => {
    it('rejects access if customer ID does not match (Customer A accessing Customer B receipt)', async () => {
      const mockPayment = {
        id: 2,
        customerId: 102,
        invoiceUrl: 'REC-2026-000002',
        status: 'PAID',
        createdAt: new Date('2026-08-20'),
      };

      prisma.paymentHistory.findFirst.mockResolvedValue(mockPayment);

      await expect(
        service.getReceipt('REC-2026-000002', 101, { role: 'CUSTOMER', customerId: 101 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows Admin user to access any customer receipt', async () => {
      const mockPayment = {
        id: 2,
        customerId: 102,
        invoiceUrl: 'REC-2026-000002',
        status: 'PAID',
        createdAt: new Date('2026-08-20'),
        customer: { id: 102, name: 'Client Two' },
      };

      prisma.paymentHistory.findFirst.mockResolvedValue(mockPayment);

      const res = await service.getReceipt('REC-2026-000002', undefined, { role: 'ADMIN' });
      expect(res.receiptNumber).toBe('REC-2026-000002');
      expect(res.status).toBe('PAID');
    });

    it('rejects access if payment is in PENDING status (e.g. offline cash not yet approved)', async () => {
      const mockPayment = {
        id: 3,
        customerId: 101,
        invoiceUrl: 'REC-2026-000003',
        status: 'PENDING',
        createdAt: new Date('2026-08-20'),
      };

      prisma.paymentHistory.findFirst.mockResolvedValue(mockPayment);

      await expect(
        service.getReceipt('REC-2026-000003', 101, { role: 'CUSTOMER', customerId: 101 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if receipt does not exist', async () => {
      prisma.paymentHistory.findFirst.mockResolvedValue(null);
      prisma.customPlanOrder.findFirst.mockResolvedValue(null);
      prisma.paymentHistory.findUnique.mockResolvedValue(null);
      prisma.customPlanOrder.findUnique.mockResolvedValue(null);

      await expect(
        service.getReceipt('REC-9999-999999', 101, { role: 'CUSTOMER', customerId: 101 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
