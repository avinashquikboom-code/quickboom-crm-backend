import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceService } from './invoice.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoiceStatus } from '@prisma/client';

describe('Customer Orders & Invoices Data Isolation & Generation Tests', () => {
  let invoiceService: InvoiceService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      invoice: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      paymentHistory: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    invoiceService = module.get<InvoiceService>(InvoiceService);
  });

  describe('1. Customer Invoices Scoping & Data Isolation', () => {
    it('queries invoices strictly scoped to the authenticated customer ID', async () => {
      const customerId = 101;
      const user = { id: 5, customerId: 101, role: 'CUSTOMER' };

      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 1,
          customerId: 101,
          invoiceNo: 'INV-2026-000001',
          totalAmount: 11799,
          subTotal: 9999,
          taxAmount: 1800,
          status: InvoiceStatus.PAID,
          issueDate: new Date('2026-08-20'),
          dueDate: new Date('2026-08-20'),
          contact: { firstName: 'Client', lastName: 'One' },
        },
      ]);
      prisma.invoice.count.mockResolvedValue(1);

      const result = await invoiceService.findAll(customerId, {}, user);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].invoiceNo).toBe('INV-2026-000001');
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 101, deletedAt: null }),
        }),
      );
    });

    it('returns empty array cleanly without error when customer has no invoices (e.g. 50% advance)', async () => {
      const customerId = 102;
      const user = { id: 6, customerId: 102, role: 'CUSTOMER' };

      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(0);

      const result = await invoiceService.findAll(customerId, {}, user);

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });

    it('filters correctly with status=PENDING mapping to unpaid states', async () => {
      const customerId = 101;
      const user = { id: 5, customerId: 101, role: 'CUSTOMER' };

      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(0);

      const result = await invoiceService.findAll(
        customerId,
        { status: 'PENDING', page: 1, limit: 20 },
        user,
      );

      expect(result.data).toEqual([]);
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 101,
            deletedAt: null,
            status: {
              in: [InvoiceStatus.PENDING, InvoiceStatus.DRAFT, InvoiceStatus.SENT],
            },
          }),
          skip: 0,
          take: 20,
        }),
      );
    });

    it('rejects unauthenticated requests without customer context', async () => {
      await expect(
        invoiceService.findAll(0, {}, { id: 10, role: 'USER' }),
      ).rejects.toThrow();
    });
  });
});

