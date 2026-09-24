import { Test, TestingModule } from '@nestjs/testing';
import { CommissionService } from './commission.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CommissionType,
  CommissionConfigStatus,
  CommissionStatus,
} from '@prisma/client';

describe('BPO Employee Commission Module — Business Logic & Test Cases', () => {
  let service: CommissionService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      commission: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      customer: {
        findUnique: jest.fn(),
      },
      employee: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      designation: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      commissionConfig: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CommissionService>(CommissionService);
  });

  // TEST 1: Telecaller Commission = 5%, Customer buys ₹10,000 -> Commission = ₹500
  it('TEST 1: Telecaller with 5% commission receives ₹500 on ₹10,000 plan purchase', async () => {
    prisma.commission.findUnique.mockResolvedValue(null);
    prisma.customer.findUnique.mockResolvedValue({
      id: 101,
      name: 'ABC Fitness',
      assignedEmployeeId: 10,
      leadId: 501,
      assignedEmployeeRel: {
        id: 10,
        firstName: 'Rahul',
        lastName: 'Sharma',
        commissionConfig: null,
        designation: {
          id: 1,
          name: 'Telecaller',
          commissionEnabled: true,
          commissionType: CommissionType.PERCENTAGE,
          commissionRate: 5.0,
        },
      },
    });

    prisma.commission.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 1, ...data }),
    );

    const result = await service.calculateAndAwardCommission({
      customerId: 101,
      purchaseId: 2001,
      purchaseAmount: 10000,
      planId: 2,
      orderId: 'ORD_101',
    });

    expect(result).toBeDefined();
    expect(result.employeeId).toBe(10);
    expect(result.commissionRate).toBe(5.0);
    expect(result.commissionAmount).toBe(500);
    expect(result.status).toBe(CommissionStatus.APPROVED);
    expect(prisma.commission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commissionAmount: 500,
          purchaseAmount: 10000,
        }),
      }),
    );
  });

  // TEST 2: Telesales Executive Commission = 7%, Customer buys ₹20,000 -> Commission = ₹1,400
  it('TEST 2: Telesales Executive with 7% receives ₹1,400 on ₹20,000 plan purchase', async () => {
    prisma.commission.findUnique.mockResolvedValue(null);
    prisma.customer.findUnique.mockResolvedValue({
      id: 102,
      name: 'XYZ Wellness',
      assignedEmployeeId: 11,
      leadId: 502,
      assignedEmployeeRel: {
        id: 11,
        firstName: 'Pooja',
        lastName: 'Verma',
        commissionConfig: null,
        designation: {
          id: 2,
          name: 'Telesales Executive',
          commissionEnabled: true,
          commissionType: CommissionType.PERCENTAGE,
          commissionRate: 7.0,
        },
      },
    });

    prisma.commission.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 2, ...data }),
    );

    const result = await service.calculateAndAwardCommission({
      customerId: 102,
      purchaseId: 2002,
      purchaseAmount: 20000,
      planId: 3,
      orderId: 'ORD_102',
    });

    expect(result).toBeDefined();
    expect(result.employeeId).toBe(11);
    expect(result.commissionRate).toBe(7.0);
    expect(result.commissionAmount).toBe(1400);
  });

  // TEST 3: Designer with Commission disabled -> No commission generated
  it('TEST 3: Designer with commission disabled receives NO commission', async () => {
    prisma.commission.findUnique.mockResolvedValue(null);
    prisma.customer.findUnique.mockResolvedValue({
      id: 103,
      name: 'Modern Interiors',
      assignedEmployeeId: 12,
      leadId: 503,
      assignedEmployeeRel: {
        id: 12,
        firstName: 'Amit',
        lastName: 'Patel',
        commissionConfig: null,
        designation: {
          id: 3,
          name: 'Graphic Designer',
          commissionEnabled: false, // DISABLED
          commissionType: CommissionType.PERCENTAGE,
          commissionRate: 0,
        },
      },
    });

    const result = await service.calculateAndAwardCommission({
      customerId: 103,
      purchaseId: 2003,
      purchaseAmount: 20000,
      planId: 3,
    });

    expect(result).toBeNull();
    expect(prisma.commission.create).not.toHaveBeenCalled();
  });

  // TEST 4 & 5: Payment failed or pending -> Never triggers calculateAndAwardCommission
  it('TEST 4 & 5: Payment must be confirmed/successful with valid purchaseId', async () => {
    const result = await service.calculateAndAwardCommission({
      customerId: 104,
      purchaseId: 0, // Invalid purchaseId (pending / unconfirmed)
      purchaseAmount: 20000,
    });

    expect(result).toBeNull();
    expect(prisma.commission.create).not.toHaveBeenCalled();
  });

  // TEST 6: Same payment webhook received twice -> ONE commission only (idempotency)
  it('TEST 6: Duplicate payment webhook / purchase ID returns existing commission without duplicate', async () => {
    const existingCommission = {
      id: 99,
      customerId: 105,
      employeeId: 10,
      purchaseId: 3001,
      purchaseAmount: 15000,
      commissionAmount: 750,
      status: CommissionStatus.APPROVED,
    };

    // First call or webhook arrives: existing commission found in DB
    prisma.commission.findUnique.mockResolvedValue(existingCommission);

    const result = await service.calculateAndAwardCommission({
      customerId: 105,
      purchaseId: 3001,
      purchaseAmount: 15000,
    });

    expect(result).toEqual(existingCommission);
    expect(prisma.commission.create).not.toHaveBeenCalled();
  });

  // TEST 7: Lead assigned to Employee A, Employee A converts -> Employee A receives commission
  it('TEST 7: Lead converted by Employee A awards commission directly to Employee A', async () => {
    prisma.commission.findUnique.mockResolvedValue(null);
    prisma.customer.findUnique.mockResolvedValue({
      id: 106,
      name: 'Alpha Dental Care',
      assignedEmployeeId: 15,
      leadId: 601,
      assignedEmployeeRel: {
        id: 15,
        firstName: 'Karan',
        lastName: 'Mehta',
        commissionConfig: null,
        designation: {
          id: 1,
          name: 'Telecaller',
          commissionEnabled: true,
          commissionType: CommissionType.PERCENTAGE,
          commissionRate: 5.0,
        },
      },
    });

    prisma.commission.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 7, ...data }),
    );

    const result = await service.calculateAndAwardCommission({
      customerId: 106,
      purchaseId: 4001,
      purchaseAmount: 30000,
      planId: 4,
    });

    expect(result.employeeId).toBe(15);
    expect(result.commissionAmount).toBe(1500); // 5% of 30,000
  });

  // TEST 8: Lead A -> Employee A, Lead B -> Employee B -> Separate commissions
  it('TEST 8: Separate leads and employees get only their own commissions', async () => {
    prisma.commission.findUnique.mockResolvedValue(null);

    // Employee A conversion
    prisma.customer.findUnique.mockResolvedValueOnce({
      id: 201,
      name: 'Customer A',
      assignedEmployeeId: 101,
      assignedEmployeeRel: {
        id: 101,
        firstName: 'Employee',
        lastName: 'A',
        designation: { commissionEnabled: true, commissionType: CommissionType.PERCENTAGE, commissionRate: 5.0 },
      },
    });
    prisma.commission.create.mockResolvedValueOnce({ id: 1001, employeeId: 101, commissionAmount: 500 });

    const resultA = await service.calculateAndAwardCommission({
      customerId: 201,
      purchaseId: 5001,
      purchaseAmount: 10000,
    });

    // Employee B conversion
    prisma.customer.findUnique.mockResolvedValueOnce({
      id: 202,
      name: 'Customer B',
      assignedEmployeeId: 102,
      assignedEmployeeRel: {
        id: 102,
        firstName: 'Employee',
        lastName: 'B',
        designation: { commissionEnabled: true, commissionType: CommissionType.PERCENTAGE, commissionRate: 10.0 },
      },
    });
    prisma.commission.create.mockResolvedValueOnce({ id: 1002, employeeId: 102, commissionAmount: 1000 });

    const resultB = await service.calculateAndAwardCommission({
      customerId: 202,
      purchaseId: 5002,
      purchaseAmount: 10000,
    });

    expect(resultA.employeeId).toBe(101);
    expect(resultB.employeeId).toBe(102);
    expect(resultA.commissionAmount).toBe(500);
    expect(resultB.commissionAmount).toBe(1000);
  });

  // TEST 9: Historical commission rate immutability: January rate 5% is preserved even if rate is later changed
  it('TEST 9: Historical commission preserves snapshot rate and amount and does not recalculate', async () => {
    // January commission was stored with commissionRate: 5.0 and commissionAmount: 500
    const januaryCommission = {
      id: 88,
      customerId: 10,
      employeeId: 5,
      purchaseId: 100,
      commissionRate: 5.0,
      purchaseAmount: 10000,
      commissionAmount: 500,
      status: CommissionStatus.APPROVED,
      createdAt: new Date('2026-01-15'),
    };

    prisma.commission.findMany.mockResolvedValue([januaryCommission]);
    prisma.commission.count.mockResolvedValue(1);
    prisma.commission.groupBy.mockResolvedValue([
      { status: CommissionStatus.APPROVED, _sum: { commissionAmount: 500 }, _count: { id: 1 } },
    ]);

    const result = await service.getAdminCommissions(10, { page: 1, limit: 10 });

    // Stored January record retains 5% and ₹500
    expect(result.data[0].commissionRate).toBe(5.0);
    expect(result.data[0].commissionAmount).toBe(500);
    expect(result.summary.approvedCommission).toBe(500);
  });

  // TEST 10: Data Capture Lead (Google Discovery -> Import -> Assignment -> WON -> Customer -> Commission)
  it('TEST 10: Google Discovery Data Capture Lead conversion properly awards commission upon plan purchase', async () => {
    prisma.commission.findUnique.mockResolvedValue(null);
    prisma.customer.findUnique.mockResolvedValue({
      id: 777,
      name: 'Green Spa & Salon',
      source: 'GOOGLE_DISCOVERY',
      leadId: 999,
      originLead: {
        id: 999,
        source: 'GOOGLE_DISCOVERY',
        employeeId: 25,
      },
      assignedEmployeeId: 25,
      assignedEmployeeRel: {
        id: 25,
        firstName: 'Vikram',
        lastName: 'Singh',
        commissionConfig: null,
        designation: {
          id: 4,
          name: 'BPO Telesales Executive',
          commissionEnabled: true,
          commissionType: CommissionType.PERCENTAGE,
          commissionRate: 6.0,
        },
      },
    });

    prisma.commission.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 10, ...data }),
    );

    const result = await service.calculateAndAwardCommission({
      customerId: 777,
      purchaseId: 8888,
      purchaseAmount: 50000,
      planId: 5,
      orderId: 'ORD_DATA_CAPTURE_777',
    });

    expect(result).toBeDefined();
    expect(result.employeeId).toBe(25);
    expect(result.commissionRate).toBe(6.0);
    expect(result.commissionAmount).toBe(3000); // 6% of 50,000
    expect(result.leadId).toBe(999);
  });

  // Admin Mark as Paid
  it('TEST 11: Admin can update status to PAID and sets paidAt timestamp', async () => {
    const existing = {
      id: 55,
      customerId: 10,
      status: CommissionStatus.APPROVED,
      paidAt: null,
    };
    prisma.commission.findUnique.mockResolvedValue(existing);
    prisma.commission.update.mockResolvedValue({
      ...existing,
      status: CommissionStatus.PAID,
      paidAt: new Date(),
    });

    const updated = await service.updateCommissionStatus(
      10,
      55,
      { status: CommissionStatus.PAID },
      { id: 1, email: 'admin@quikboom.com' },
    );

    expect(updated.status).toBe(CommissionStatus.PAID);
    expect(updated.paidAt).toBeDefined();
  });

  // Invalidation on Refund
  it('TEST 12: Invalidation cancels commission on refund', async () => {
    const commission = {
      id: 60,
      customerId: 10,
      purchaseId: 9001,
      status: CommissionStatus.APPROVED,
    };
    prisma.commission.findUnique.mockResolvedValue(commission);
    prisma.commission.update.mockResolvedValue({
      ...commission,
      status: CommissionStatus.CANCELLED,
    });

    await service.handleRefundOrCancellation(9001, 10);

    expect(prisma.commission.update).toHaveBeenCalledWith({
      where: { id: 60 },
      data: { status: CommissionStatus.CANCELLED },
    });
  });
});
