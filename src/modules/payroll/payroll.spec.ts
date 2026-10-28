import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PayrollService (HRM Payroll)', () => {
  let service: PayrollService;
  let prisma: any;

  const mockPayroll = {
    id: 101,
    customerId: 3,
    month: 8,
    year: 2026,
    departmentId: null,
    status: 'CALCULATED',
    grossSalary: 65000,
    totalDeductions: 8500,
    netSalary: 56500,
    totalEmployees: 1,
    processedAt: new Date(),
    approvedAt: null,
    disbursedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      {
        id: 1,
        payrollId: 101,
        customerId: 3,
        employeeId: 10,
        basicSalary: 35000,
        hra: 14000,
        allowances: 6000,
        specialAllowance: 5000,
        bonus: 0,
        commission: 0,
        overtime: 0,
        otherEarnings: 0,
        pf: 4200,
        esi: 260,
        professionalTax: 200,
        tds: 1500,
        otherDeductions: 0,
        grossSalary: 60000,
        totalDeductions: 6160,
        netSalary: 53840,
        status: 'CALCULATED',
      },
    ],
  };

  const mockEmployee = {
    id: 10,
    customerId: 3,
    employeeCode: 'EMP001',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    status: 'ACTIVE',
    departmentId: 1,
    salaryStructures: [
      {
        id: 1,
        customerId: 3,
        employeeId: 10,
        basicSalary: 35000,
        hra: 14000,
        allowances: 6000,
        specialAllowance: 5000,
        bonus: 0,
        commission: 0,
        overtime: 0,
        otherEarnings: 0,
        pf: 4200,
        esi: 260,
        professionalTax: 200,
        tds: 1500,
        otherDeductions: 0,
        grossSalary: 60000,
        totalDeductions: 6160,
        netSalary: 53840,
        status: 'ACTIVE',
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 3 }),
      },
      employee: {
        findMany: jest.fn().mockResolvedValue([mockEmployee]),
        findFirst: jest.fn().mockResolvedValue(mockEmployee),
      },
      payroll: {
        findFirst: jest.fn().mockResolvedValue(mockPayroll),
        findMany: jest.fn().mockResolvedValue([mockPayroll]),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(mockPayroll),
        update: jest.fn().mockResolvedValue({ ...mockPayroll, status: 'APPROVED', approvedAt: new Date() }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payrollItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      salarySlip: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1, slipNumber: 'SLIP-202608-0010' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      salaryStructure: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue({ id: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PayrollService>(PayrollService);
  });

  describe('approvePayroll', () => {
    it('approves payroll with string/identifier "pr-current" without 500 error', async () => {
      prisma.payroll.findFirst.mockResolvedValue(mockPayroll);
      prisma.payroll.update.mockResolvedValue({
        ...mockPayroll,
        status: 'APPROVED',
        approvedAt: new Date(),
      });

      const result = await service.approvePayroll(3, 'pr-current');

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('APPROVED');
      expect(prisma.payroll.update).toHaveBeenCalledWith({
        where: { id: 101 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedAt: expect.any(Date),
        }),
      });
    });

    it('approves payroll with numeric ID', async () => {
      prisma.payroll.findFirst.mockResolvedValue(mockPayroll);
      prisma.payroll.update.mockResolvedValue({
        ...mockPayroll,
        status: 'APPROVED',
        approvedAt: new Date(),
      });

      const result = await service.approvePayroll(3, 101);

      expect(result.success).toBe(true);
      expect(prisma.payroll.update).toHaveBeenCalledWith({
        where: { id: 101 },
        data: expect.objectContaining({
          status: 'APPROVED',
        }),
      });
    });
  });

  describe('disbursePayroll', () => {
    it('disburses payroll with "pr-current" without 500 error', async () => {
      prisma.payroll.findFirst.mockResolvedValue(mockPayroll);
      prisma.payroll.update.mockResolvedValue({
        ...mockPayroll,
        status: 'PAID',
        disbursedAt: new Date(),
      });

      const result = await service.disbursePayroll(3, 'pr-current');

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('PAID');
      expect(prisma.payroll.update).toHaveBeenCalledWith({
        where: { id: 101 },
        data: expect.objectContaining({
          status: 'PAID',
          disbursedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('calculatePayroll', () => {
    it('calculates gross, deductions, and net salary for active employees', async () => {
      prisma.payroll.findFirst.mockResolvedValue(null);
      prisma.payroll.create.mockResolvedValue(mockPayroll);
      prisma.payroll.update.mockResolvedValue(mockPayroll);

      const result = await service.calculatePayroll(3, 8, 2026);

      expect(result).toBeDefined();
      expect(prisma.employee.findMany).toHaveBeenCalled();
      expect(prisma.payrollItem.createMany).toHaveBeenCalled();
    });
  });

  describe('generatePayroll', () => {
    it('generates salary slips for payroll batch', async () => {
      prisma.payroll.findFirst.mockResolvedValue(mockPayroll);
      prisma.payroll.update.mockResolvedValue({
        ...mockPayroll,
        status: 'GENERATED',
      });

      const result = await service.generatePayroll(3, 101);

      expect(result.success).toBe(true);
      expect(prisma.salarySlip.create).toHaveBeenCalled();
    });
  });
});
